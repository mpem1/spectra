/**
 * Neon Split — WebGL2 renderer running the effect.app preset's own effect
 * shaders, ported verbatim from the decrypted GLSL the site serves its editor
 * (levels, bloom, noise, gradient-map, curves, layer-mix-curve). One offscreen
 * GL canvas runs the same pass chain the real preset runs, in the same order
 * with the same constants, then the result is drawn back onto the 2D context.
 *
 * Fidelity notes (why each stage exists — the user asked for the REAL thing):
 *   levels+mask   the published preset inverts the UPPER part of the frame
 *                 behind a vertical smooth gradient mask (center 0.074,-0.094,
 *                 width 0.3, rotation 90) — that IS the "split": full invert
 *                 from the top edge, fade centered ~45% down, gone by ~55%
 *                 (measured off effect.app's own render of a luminance-ramp
 *                 test image). The engine's mask frame is Y-down (mask y=-1
 *                 = the image's TOP edge), so the shader negates vUV.y to
 *                 enter that frame — see the constructor note.
 *   bloom         threshold 0.1 / knee 0.29 / intensity 3 bright pass into a
 *                 real 6-level mip pyramid, sampled LOD 0-5, ×0.65, screen
 *                 blend in linear light (the engine's bloom-1/bloom-3 pair).
 *   noise         the noise shader verbatim: 3-octave value noise on the
 *                 1103515245 uint hash, cell 0.5, chroma 0.69, tone weights
 *                 0.25/0.4/0.53, strength exp2-dialed, applied in linear
 *                 light with the min-grain weight floor. The lookup position
 *                 can be offset per frame (uGrainOffset) so the grain can
 *                 churn like film — 0 offset = the published preset's still
 *                 grain.
 *   gradient map  luminance (Rec.709) → the preset's own 4-stop gradient.
 *   curves        the preset's master curve, apply-mode L (setLuma), node
 *                 opacity 0.54.
 *   layer mixes   black paper screened at 0.8 (fill 1.22, rot -180, texture
 *                 curve) and folded paper hard-lit at 0.32 (tile 0.63, rot
 *                 90, blend mask from the two ramp LUTs).
 *
 * Deterministic: fixed-point pipeline, no extensions, generateMipmap's box
 * filter, and the in-shader dither is hash-based — same frame in, same pixels
 * out, in the live preview and the offline export.
 */

import {
  CURVE_POINTS,
  buildCurveLut,
  buildRampLut,
  gradientLutPixels,
  makeBlackPaperTexture,
  makeFoldedPaperTexture,
  scalarLutPixels,
} from './neon-split-data'

/* --------------------------------- shaders --------------------------------- */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const COMMON = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
`

/* --- P1: levels (full invert) behind the vertical smooth gradient mask --- */
const FRAG_LEVELS = COMMON + `
uniform sampler2D iChannel0;
uniform vec2 uCenter;     // engine mask frame: x right, y DOWN (-1 = image top)
uniform float uWidth;     // rel units (1 = half the short side)
uniform float uRotation;  // degrees
uniform float uAspect;
float smooth01(float t) { return t * t * (3.0 - 2.0 * t); }
void main() {
  vec3 rgb = texture(iChannel0, vUV).rgb;
  vec3 inv = vec3(1.0) - rgb;                       // input_levels [1,0] → invert
  vec2 relScale = uAspect > 1.0 ? vec2(uAspect, 1.0) : vec2(1.0, 1.0 / uAspect);
  // vUV is display-upright (v=1 = the image's top edge after the
  // flip-at-upload); the engine's mask frame is Y-down, so negate y —
  // full invert lands at the TOP of the picture, exactly like effect.app
  vec2 rel = vec2(vUV.x * 2.0 - 1.0, 1.0 - vUV.y * 2.0) * relScale;
  vec2 c = uCenter * relScale;
  float a = radians(uRotation);
  vec2 dir = vec2(cos(a), sin(a));
  float s = dot(rel - c, dir) / max(uWidth, 1e-4);
  float t = s * 0.5 + 0.5;                          // GRADIENT_LINEAR
  float m = 1.0 - clamp(t, 0.0, 1.0);
  m = smooth01(m);                                  // CURVE_SMOOTH
  outColor = vec4(mix(rgb, inv, m), 1.0);
}`

/* --- P2: bloom-1 bright pass (exact sRGB→linear, soft knee, intensity) --- */
const FRAG_BRIGHT = COMMON + `
uniform sampler2D iChannel0;
uniform float uThreshold;
uniform float uKnee;
uniform float uIntensity;
float luminance(vec3 col) { return dot(col, vec3(0.2126729, 0.7151522, 0.0721750)); }
vec3 srgbToLinear(vec3 col) {
  bvec3 cutoff = lessThanEqual(col, vec3(0.04045));
  vec3 lo = col / 12.92;
  vec3 hi = pow((col + 0.055) / 1.055, vec3(2.4));
  return mix(hi, lo, vec3(cutoff));
}
void main() {
  vec3 colorLin = srgbToLinear(texture(iChannel0, vUV).rgb);
  float Y = luminance(colorLin);
  float safeKnee = max(uKnee, 1e-6);
  float x = max(Y - (uThreshold - safeKnee), 0.0);
  float mask = clamp((x * x) / (4.0 * safeKnee * x + 1e-6), 0.0, 1.0);
  vec3 bright = colorLin * mask * uIntensity;
  outColor = vec4(clamp(bright, 0.0, 1.0), 1.0);    // RGBA8 storage clamps
}`

/* --- P3: bloom-3 (LOD 0-5 average, ×factor, screen in linear, →sRGB) --- */
const FRAG_BLOOM = COMMON + `
uniform sampler2D iPyramid;
uniform sampler2D iBase;
uniform float uBloomFactor;
vec3 linearTosRGB(vec3 col) {
  col = max(col, vec3(0.0));
  bvec3 cutoff = lessThanEqual(col, vec3(0.0031308));
  vec3 lo = col * 12.92;
  vec3 hi = 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(cutoff));
}
void main() {
  vec3 col = textureLod(iPyramid, vUV, 0.0).rgb
           + textureLod(iPyramid, vUV, 1.0).rgb
           + textureLod(iPyramid, vUV, 2.0).rgb
           + textureLod(iPyramid, vUV, 3.0).rgb
           + textureLod(iPyramid, vUV, 4.0).rgb
           + textureLod(iPyramid, vUV, 5.0).rgb;
  col /= 6.0;
  vec3 baseColor = texture(iBase, vUV).rgb;
  vec3 bloomColor = col * uBloomFactor;
  col = vec3(1.0) - (vec3(1.0) - baseColor) * (vec3(1.0) - bloomColor); // screen
  outColor = vec4(linearTosRGB(col), 1.0);
}`

/* --- P4: noise (the decrypted noise shader, verbatim math) --- */
const FRAG_NOISE = COMMON + `
uniform sampler2D iChannel0;
uniform vec2 iResolution;
uniform vec2 uGrainOffset;   // animated grain position (px) — 0 = the still preset
uniform float strength;
uniform float grainSize;
uniform float minGrain;
uniform float chroma;
uniform float shadowWeight;
uniform float midWeight;
uniform float highlightWeight;
vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
float hash(vec2 p) {
  const uint k = 1103515245u;
  uvec2 x = uvec2(floatBitsToUint(p.x), floatBitsToUint(p.y));
  x = ((x >> 8u) ^ x.yx) * k;
  x = ((x >> 8u) ^ x.yx) * k;
  return uintBitsToFloat((x.x & 0x007FFFFFu) | 0x3F800000u) - 1.0;
}
float valueNoise(vec2 px, float cell) {
  vec2 g = px / cell;
  vec2 i = floor(g), f = fract(g);
  float n00 = hash(i);
  float n10 = hash(i + vec2(1, 0));
  float n01 = hash(i + vec2(0, 1));
  float n11 = hash(i + vec2(1, 1));
  return mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
}
float fractalNoise(vec2 p, float cell) {
  float sum = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 3; ++i) {
    sum += (valueNoise(p, cell * freq) * 2.0 - 1.0) * amp;
    norm += amp;
    freq *= 2.0;
    amp *= 0.5;
  }
  return sum / norm;
}
void main() {
  vec2 fragCoord = vUV * iResolution + uGrainOffset;
  vec3 texSrgb = texture(iChannel0, vUV).rgb;
  vec3 base = srgbToLinear(texSrgb);
  float cell = max(grainSize, 0.5);
  float n  = fractalNoise(fragCoord, cell);
  float nR = fractalNoise(fragCoord + vec2(19.3, 37.7), cell);
  float nG = fractalNoise(fragCoord + vec2(73.1, 11.9), cell);
  float nB = fractalNoise(fragCoord + vec2(45.4, 62.3), cell);
  vec3 grain = mix(vec3(n), vec3(nR, nG, nB), chroma);
  float luma = dot(texSrgb, vec3(0.2126, 0.7152, 0.0722));
  float sh = smoothstep(0.40, 0.00, luma);
  float hl = smoothstep(0.60, 1.00, luma);
  float md = clamp(1.0 - sh - hl, 0.0, 1.0);
  float toneGain = pow(sh * shadowWeight + md * midWeight + hl * highlightWeight, 0.6);
  grain *= toneGain;
  grain *= exp2(strength) - 1.0;
  vec3 weight = min(base * (1.0 - base), vec3(0.25));
  vec3 w = clamp(weight + minGrain * (1.0 - 4.0 * weight), vec3(minGrain), vec3(0.25));
  vec3 outCol = max(base + grain * w, 0.0);
  outColor = vec4(linearToSrgb(outCol), 1.0);
}`

/* --- P5: gradient map (Rec.709 luminance → the preset's gradient LUT) --- */
const FRAG_GRADIENT = COMMON + `
uniform sampler2D iChannel0;
uniform sampler2D iLut;
void main() {
  vec4 base = texture(iChannel0, vUV);
  float luminance = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
  float t = luminance;
  outColor = texture(iLut, vec2(t, 0.5));
}`

/* --- P6: curves (apply mode L: setLuma(base, curvedLuma)) + node opacity --- */
const FRAG_CURVES = COMMON + `
uniform sampler2D iChannel0;
uniform sampler2D iLut;
uniform float uOpacity;
float luma709(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }
vec3 clipColor(vec3 color) {
  float l = luma709(color);
  float n = min(min(color.r, color.g), color.b);
  float x = max(max(color.r, color.g), color.b);
  if (n < 0.0) color = vec3(l) + (color - vec3(l)) * (l / max(l - n, 1e-6));
  if (x > 1.0) color = vec3(l) + (color - vec3(l)) * ((1.0 - l) / max(x - l, 1e-6));
  return color;
}
void main() {
  vec4 base = texture(iChannel0, vUV);
  float baseLuma = luma709(base.rgb);
  float curvedLuma = texture(iLut, vec2(clamp(baseLuma, 0.0, 1.0), 0.5)).a;
  vec3 color = base.rgb + vec3(curvedLuma - baseLuma);
  color = clamp(clipColor(color), 0.0, 1.0);
  outColor = vec4(mix(base.rgb, color, uOpacity), base.a);
}`

/* --- P7/P8: layer-mix-curve (the decrypted layer-mix shader, verbatim) --- */
const FRAG_LAYER_MIX = COMMON + `
uniform sampler2D iChannel0;   // base (underlying)
uniform sampler2D iChannel2;   // texture
uniform sampler2D iTexCurve;   // texture curve LUT (alpha)
uniform sampler2D iRampCurrent;  // "this layer" ramp LUT (alpha)
uniform sampler2D iRampUnder;    // "underlying layer" ramp LUT (alpha)
uniform vec2 iResolution;
uniform float uAspect;
uniform float uFit;            // 0 fill, 2 tile
uniform float uBlendMode;      // 2 screen, 5 hard light
uniform float uOpacity;
uniform float uTexScale;
uniform float uTexRotation;
uniform float uTexCurveOn;     // 0 = apply the texture curve, 1 = pass through
float getChannelValue(vec4 color) { return dot(color.rgb, vec3(0.299, 0.587, 0.114)); }
float sampleRampLut(sampler2D lut, float v) {
  float w = float(textureSize(lut, 0).x);
  float u = (clamp(v, 0.0, 1.0) * (w - 1.0) + 0.5) / w;
  return texture(lut, vec2(u, 0.5)).a;
}
float sampleTextureCurve(float v) { return texture(iTexCurve, vec2(clamp(v, 0.0, 1.0), 0.5)).a; }
vec3 applyTextureCurve(vec3 c) {
  if (uTexCurveOn > 0.5) return c;
  return vec3(sampleTextureCurve(c.r), sampleTextureCurve(c.g), sampleTextureCurve(c.b));
}
vec2 transformCanvasUV(vec2 uv) {
  float a = radians(uTexRotation);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  p = mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
  return p / vec2(uAspect, 1.0) + 0.5;
}
vec2 calculateTextureUV(vec2 uv) {
  if (uFit < 0.5) {
    float canvasAspect = uAspect;
    vec2 texSize = vec2(textureSize(iChannel2, 0));
    float textureAspect = texSize.x / texSize.y;
    vec2 adjustedUV = uv;
    if (canvasAspect > textureAspect) {
      float heightScale = canvasAspect / textureAspect;
      adjustedUV.y = (uv.y - 0.5) / heightScale + 0.5;
    } else {
      float widthScale = textureAspect / canvasAspect;
      adjustedUV.x = (uv.x - 0.5) / widthScale + 0.5;
    }
    return (adjustedUV - 0.5) / uTexScale + 0.5;
  } else {
    float canvasAspect = uAspect;
    vec2 texSize = vec2(textureSize(iChannel2, 0));
    float textureAspect = texSize.x / texSize.y;
    vec2 adjustedUV = uv;
    if (canvasAspect > textureAspect) {
      adjustedUV.x = uv.x * (canvasAspect / textureAspect);
    } else {
      adjustedUV.y = uv.y * (textureAspect / canvasAspect);
    }
    return adjustedUV * uTexScale;
  }
}
vec2 wrapTexelCoord(vec2 coord, vec2 size) { return mod(coord, size); }
vec4 sampleTiledTexture(sampler2D tex, vec2 uv) {
  vec2 texSize = vec2(textureSize(tex, 0));
  vec2 texelPos = fract(uv) * texSize - 0.5;
  vec2 base = floor(texelPos);
  vec2 f = fract(texelPos);
  vec2 p00 = wrapTexelCoord(base, texSize);
  vec2 p10 = wrapTexelCoord(base + vec2(1.0, 0.0), texSize);
  vec2 p01 = wrapTexelCoord(base + vec2(0.0, 1.0), texSize);
  vec2 p11 = wrapTexelCoord(base + vec2(1.0, 1.0), texSize);
  vec4 c00 = texelFetch(tex, ivec2(p00), 0);
  vec4 c10 = texelFetch(tex, ivec2(p10), 0);
  vec4 c01 = texelFetch(tex, ivec2(p01), 0);
  vec4 c11 = texelFetch(tex, ivec2(p11), 0);
  vec4 cx0 = mix(c00, c10, f.x);
  vec4 cx1 = mix(c01, c11, f.x);
  return mix(cx0, cx1, f.y);
}
vec3 blendScreen(vec3 base, vec3 src) { return 1.0 - (1.0 - base) * (1.0 - src); }
vec3 blendHardLight(vec3 base, vec3 src) {
  return vec3(
    src.r < 0.5 ? 2.0 * base.r * src.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - src.r),
    src.g < 0.5 ? 2.0 * base.g * src.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - src.g),
    src.b < 0.5 ? 2.0 * base.b * src.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - src.b)
  );
}
vec3 applyBlendMode(vec3 base, vec3 blend) {
  if (uBlendMode < 2.5) return blendScreen(base, blend);
  return blendHardLight(base, blend);
}
void main() {
  vec4 baseColor = texture(iChannel0, vUV);
  vec2 textureUV = calculateTextureUV(transformCanvasUV(vUV));
  vec4 layerColor = (uFit < 0.5)
    ? texture(iChannel2, clamp(textureUV, 0.0, 1.0))
    : sampleTiledTexture(iChannel2, textureUV);
  vec3 texRgb = applyTextureCurve(layerColor.rgb);
  float blendMask = sampleRampLut(iRampCurrent, getChannelValue(vec4(texRgb, layerColor.a)))
                  * sampleRampLut(iRampUnder, getChannelValue(baseColor));
  float srcA = uOpacity * layerColor.a * blendMask;
  vec3 blended = applyBlendMode(baseColor.rgb, texRgb);
  vec3 srcColor = mix(texRgb, blended, baseColor.a);
  outColor = vec4(mix(baseColor.rgb, srcColor, srcA), 1.0);
}`

/* ------------------------------ GL plumbing -------------------------------- */

type GlPass = {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3])

export class NeonSplitGL {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement
  private w = 0
  private h = 0
  private srcW = 0
  private srcH = 0
  private quadVao: WebGLVertexArrayObject | null = null
  private quadBuf: WebGLBuffer | null = null
  private passes = new Map<string, GlPass>()
  private fbos: { fb: WebGLFramebuffer; tex: WebGLTexture }[] = []
  private pyramid: WebGLTexture | null = null
  private pyramidW = 0
  private pyramidH = 0
  private srcTex: WebGLTexture | null = null
  private lutTexs = new Map<string, WebGLTexture>()
  private paperTex1: WebGLTexture | null = null
  private paperTex2: WebGLTexture | null = null
  private lastCurveKey = -1
  private lost = false

  constructor() {
    this.canvas = document.createElement('canvas')
    this.gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    }) as WebGL2RenderingContext
    if (!this.gl) throw new Error('no webgl2')
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    this.initGeometry()
    this.initLuts()
    this.initPapers()
    // From here on, canvas-backed uploads (the source frame) go in with Y
    // flipped: WebGL textures put the first pixel row at v=0, and without the
    // flip every pass samples the picture upside down — the whole output came
    // out inverted vertically (bars hung from the top). Flipping at upload
    // keeps the picture upright end to end. The preset's gradient mask does
    // NOT live in this display space: the engine defines its mask frame
    // Y-down (mask y=-1 = the image's TOP edge) — measured off the site's own
    // render of a calibrated luminance-ramp (full invert to ~38% height, fade
    // centered ~45%, gone by ~55%) — so the levels shader negates vUV.y to
    // enter that frame, which is what puts the inversion band over the TOP of
    // the picture exactly where effect.app puts it. LUT uploads are typed
    // arrays (unaffected by the flip) and the paper textures were already
    // uploaded above, orientation-neutral.
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true)
    this.compileAll()
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost()
  }

  /** Free every GL resource (context loss recovery — a fresh instance takes
   *  over on a new canvas afterwards). */
  dispose(): void {
    try {
      this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* already lost */
    }
    this.passes.clear()
    this.fbos = []
    this.pyramid = null
    this.srcTex = null
    this.lutTexs.clear()
    this.paperTex1 = null
    this.paperTex2 = null
  }

  private initGeometry() {
    const gl = this.gl
    this.quadVao = gl.createVertexArray()
    this.quadBuf = gl.createBuffer()
    gl.bindVertexArray(this.quadVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  private makeLutTex(pixels: Uint8Array): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private initLuts() {
    const gl = this.gl
    // curve LUT — the preset's master curve, contrast-neutral (identity is
    // blended in JS per config and re-uploaded when the dial moves)
    this.lutTexs.set('curve', this.makeLutTex(scalarLutPixels(buildCurveLut(CURVE_POINTS))))
    // layer-mix #1's texture curve (black paper)
    this.lutTexs.set(
      'texCurve',
      this.makeLutTex(scalarLutPixels(buildRampLut([[0.0759, 0], [0.433, 0.75], [1, 1]]))),
    )
    // layer-mix #1's blend ramps: both all-ones (the published preset)
    this.lutTexs.set('rampOnes', this.makeLutTex(scalarLutPixels(buildRampLut([[0, 1], [1, 1]]))))
    // layer-mix #2's blend ramps (the published preset)
    this.lutTexs.set(
      'rampCurrent',
      this.makeLutTex(scalarLutPixels(buildRampLut([[0.1875, 1], [1, 0]]))),
    )
    this.lutTexs.set(
      'rampUnder',
      this.makeLutTex(scalarLutPixels(buildRampLut([[0, 0], [0.9598, 1]]))),
    )
    // gradient LUTs per ramp
    for (const ramp of ['violet', 'uv', 'acid', 'ember', 'ice']) {
      this.lutTexs.set('grad:' + ramp, this.makeLutTex(gradientLutPixels(ramp)))
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  }

  private initPapers() {
    const gl = this.gl
    const up = (cv: HTMLCanvasElement): WebGLTexture => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
      return tex
    }
    this.paperTex1 = up(makeBlackPaperTexture(512))
    this.paperTex2 = up(makeFoldedPaperTexture(512))
  }

  private compile(fragSrc: string): WebGLProgram {
    const gl = this.gl
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader compile: ' + gl.getShaderInfoLog(sh))
      }
      return sh
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('program link: ' + gl.getProgramInfoLog(prog))
    }
    return prog
  }

  private makePass(key: string, fragSrc: string, uniforms: string[]): GlPass {
    const gl = this.gl
    const program = this.compile(fragSrc)
    const u: Record<string, WebGLUniformLocation | null> = {}
    for (const name of uniforms) u[name] = gl.getUniformLocation(program, name)
    const pass = { program, uniforms: u }
    this.passes.set(key, pass)
    return pass
  }

  private compileAll() {
    this.makePass(
      'levels',
      FRAG_LEVELS,
      ['iChannel0', 'uCenter', 'uWidth', 'uRotation', 'uAspect'],
    )
    this.makePass('bright', FRAG_BRIGHT, ['iChannel0', 'uThreshold', 'uKnee', 'uIntensity'])
    this.makePass('bloom', FRAG_BLOOM, ['iPyramid', 'iBase', 'uBloomFactor'])
    this.makePass(
      'noise',
      FRAG_NOISE,
      ['iChannel0', 'iResolution', 'uGrainOffset', 'strength', 'grainSize', 'minGrain', 'chroma', 'shadowWeight', 'midWeight', 'highlightWeight'],
    )
    this.makePass('gradient', FRAG_GRADIENT, ['iChannel0', 'iLut'])
    this.makePass('curves', FRAG_CURVES, ['iChannel0', 'iLut', 'uOpacity'])
    this.makePass(
      'mix1',
      FRAG_LAYER_MIX,
      ['iChannel0', 'iChannel2', 'iTexCurve', 'iRampCurrent', 'iRampUnder', 'iResolution', 'uAspect', 'uFit', 'uBlendMode', 'uOpacity', 'uTexScale', 'uTexRotation', 'uTexCurveOn'],
    )
    this.makePass(
      'mix2',
      FRAG_LAYER_MIX,
      ['iChannel0', 'iChannel2', 'iTexCurve', 'iRampCurrent', 'iRampUnder', 'iResolution', 'uAspect', 'uFit', 'uBlendMode', 'uOpacity', 'uTexScale', 'uTexRotation', 'uTexCurveOn'],
    )
  }

  private ensureSize(w: number, h: number) {
    if (this.w === w && this.h === h) return
    const gl = this.gl
    for (const f of this.fbos) {
      gl.deleteFramebuffer(f.fb)
      gl.deleteTexture(f.tex)
    }
    this.fbos = []
    this.canvas.width = w
    this.canvas.height = h
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.fbos.push({ fb, tex })
    }
    // bloom pyramid — mipmapped
    if (this.pyramid) gl.deleteTexture(this.pyramid)
    this.pyramid = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.pyramid)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.generateMipmap(gl.TEXTURE_2D)
    this.pyramidW = w
    this.pyramidH = h
    this.w = w
    this.h = h
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** The source-frame texture always matches the SOURCE canvas pixel size —
   *  the pass chain may render at a smaller internal scale while sampling
   *  this full-res texture (linear filtered), so a perf-stressed live
   *  preview can drop resolution without touching the pipeline. */
  private ensureSrcSize(w: number, h: number) {
    if (this.srcW === w && this.srcH === h) return
    const gl = this.gl
    if (this.srcTex) gl.deleteTexture(this.srcTex)
    this.srcTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.srcW = w
    this.srcH = h
  }

  private use(texUnit: number, tex: WebGLTexture | null, loc: WebGLUniformLocation | null) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + texUnit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (loc) gl.uniform1i(loc, texUnit)
  }

  private renderPass(
    pass: GlPass,
    target: WebGLFramebuffer | null,
    setUniforms: () => void,
  ) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(pass.program)
    setUniforms()
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  /** Run the whole preset chain over the given 2D source; returns the GL
   *  canvas holding the finished frame (draw it onto the 2D context).
   *  bloomIntensity / noiseStrength / paperAmount / curveMix arrive already
   *  mapped from the config dials (0.5 = the published preset's own value).
   *  grainOffsetX/Y shift the noise lattice per frame (animated grain — 0/0
   *  is the published preset's still grain). scale < 1 renders the chain at
   *  a lower internal resolution (perf escape hatch for the live preview). */
  render(p: {
    source: HTMLCanvasElement
    bloomIntensity: number
    noiseStrength: number
    paperAmount: number
    curveMix: number
    curveLut: Float32Array
    ramp: string
    grainOffsetX: number
    grainOffsetY: number
    scale: number
  }): HTMLCanvasElement {
    const gl = this.gl
    const w = p.source.width
    const h = p.source.height
    if (gl.isContextLost() || this.lost) throw new Error('gl lost')
    this.ensureSrcSize(w, h)
    const rw = Math.max(8, Math.round(w * p.scale))
    const rh = Math.max(8, Math.round(h * p.scale))
    this.ensureSize(rw, rh)

    // the curves LUT follows the contrast dial — re-upload when it moves
    const curveKey = Math.round(p.curveMix * 100)
    if (this.lastCurveKey !== curveKey) {
      const lut = new Float32Array(256)
      for (let i = 0; i < 256; i++) {
        const t = i / 255
        lut[i] = t + (p.curveLut[i] - t) * p.curveMix
      }
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexs.get('curve')!)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, scalarLutPixels(lut))
      this.lastCurveKey = curveKey
    }

    // upload the source frame (full-res, Y-flipped at upload — see the
    // constructor note on UNPACK_FLIP_Y_WEBGL)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, p.source)

    const aspect = w / h
    const A = this.fbos[0]
    const B = this.fbos[1]
    const P = (k: string) => this.passes.get(k)!

    // 1) levels (invert) behind the vertical smooth gradient mask  src → A
    this.renderPass(P('levels'), A.fb, () => {
      this.use(0, this.srcTex, P('levels').uniforms.iChannel0)
      gl.uniform2f(P('levels').uniforms.uCenter, 0.074, -0.094)
      gl.uniform1f(P('levels').uniforms.uWidth, 0.3)
      gl.uniform1f(P('levels').uniforms.uRotation, 90)
      gl.uniform1f(P('levels').uniforms.uAspect, aspect)
    })

    // 2) bloom-1 bright pass  A → B
    this.renderPass(P('bright'), B.fb, () => {
      this.use(0, A.tex, P('bright').uniforms.iChannel0)
      gl.uniform1f(P('bright').uniforms.uThreshold, 0.1)
      gl.uniform1f(P('bright').uniforms.uKnee, 0.29)
      gl.uniform1f(P('bright').uniforms.uIntensity, p.bloomIntensity)
    })
    // copy the bright pass into the mip pyramid (the engine uploads the
    // bright pass as a texture and runs generateMipmap)
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.fb)
    gl.bindTexture(gl.TEXTURE_2D, this.pyramid)
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.w, this.h)
    gl.generateMipmap(gl.TEXTURE_2D)

    // 3) bloom-3: 6-LOD average ×0.65 screened over the levels output  → B
    this.renderPass(P('bloom'), B.fb, () => {
      this.use(0, this.pyramid, P('bloom').uniforms.iPyramid)
      this.use(1, A.tex, P('bloom').uniforms.iBase)
      gl.uniform1f(P('bloom').uniforms.uBloomFactor, 0.65)
    })

    // 4) film grain (linear-light, verbatim noise shader)  B → A
    this.renderPass(P('noise'), A.fb, () => {
      this.use(0, B.tex, P('noise').uniforms.iChannel0)
      gl.uniform2f(P('noise').uniforms.iResolution, this.w, this.h)
      gl.uniform2f(P('noise').uniforms.uGrainOffset, p.grainOffsetX, p.grainOffsetY)
      gl.uniform1f(P('noise').uniforms.strength, p.noiseStrength)
      gl.uniform1f(P('noise').uniforms.grainSize, 0.5)
      gl.uniform1f(P('noise').uniforms.minGrain, 0.14)
      gl.uniform1f(P('noise').uniforms.chroma, 0.69)
      gl.uniform1f(P('noise').uniforms.shadowWeight, 0.25)
      gl.uniform1f(P('noise').uniforms.midWeight, 0.4)
      gl.uniform1f(P('noise').uniforms.highlightWeight, 0.53)
    })

    // 5) gradient map — the preset's own gradient  A → B
    this.renderPass(P('gradient'), B.fb, () => {
      this.use(0, A.tex, P('gradient').uniforms.iChannel0)
      this.use(1, this.lutTexs.get('grad:' + p.ramp) ?? this.lutTexs.get('grad:violet')!, P('gradient').uniforms.iLut)
    })

    // 6) curves — apply mode L + node opacity 0.54  B → A
    this.renderPass(P('curves'), A.fb, () => {
      this.use(0, B.tex, P('curves').uniforms.iChannel0)
      this.use(1, this.lutTexs.get('curve')!, P('curves').uniforms.iLut)
      gl.uniform1f(P('curves').uniforms.uOpacity, 0.54)
    })

    // 7) layer mix #1 — black paper, screen 0.8, fill 1.22, rot -180  A → B
    this.renderPass(P('mix1'), B.fb, () => {
      const U = P('mix1').uniforms
      this.use(0, A.tex, U.iChannel0)
      this.use(1, this.paperTex1, U.iChannel2)
      this.use(2, this.lutTexs.get('texCurve')!, U.iTexCurve)
      this.use(3, this.lutTexs.get('rampOnes')!, U.iRampCurrent)
      this.use(4, this.lutTexs.get('rampOnes')!, U.iRampUnder)
      gl.uniform2f(U.iResolution, this.w, this.h)
      gl.uniform1f(U.uAspect, aspect)
      gl.uniform1f(U.uFit, 0)
      gl.uniform1f(U.uBlendMode, 2)
      gl.uniform1f(U.uOpacity, 0.8 * p.paperAmount)
      gl.uniform1f(U.uTexScale, 1.22)
      gl.uniform1f(U.uTexRotation, -180)
      gl.uniform1f(U.uTexCurveOn, 0)
    })

    // 8) layer mix #2 — folded paper, hard light 0.32, tile 0.63, rot 90  → canvas
    this.renderPass(P('mix2'), null, () => {
      const U = P('mix2').uniforms
      this.use(0, B.tex, U.iChannel0)
      this.use(1, this.paperTex2, U.iChannel2)
      this.use(2, this.lutTexs.get('curve')!, U.iTexCurve) // unused (uTexCurveOn 1)
      this.use(3, this.lutTexs.get('rampCurrent')!, U.iRampCurrent)
      this.use(4, this.lutTexs.get('rampUnder')!, U.iRampUnder)
      gl.uniform2f(U.iResolution, this.w, this.h)
      gl.uniform1f(U.uAspect, aspect)
      gl.uniform1f(U.uFit, 2)
      gl.uniform1f(U.uBlendMode, 5)
      gl.uniform1f(U.uOpacity, 0.32 * p.paperAmount)
      gl.uniform1f(U.uTexScale, 0.63)
      gl.uniform1f(U.uTexRotation, 90)
      gl.uniform1f(U.uTexCurveOn, 1)
    })

    return this.canvas
  }
}

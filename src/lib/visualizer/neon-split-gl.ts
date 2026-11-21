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
 *   gradient map  luminance (Rec.709) → the preset's own 4-stop gradient,
 *                 blended back toward the original colors by the amount dial.
 *   curves        the preset's master curve, apply-mode L (setLuma), node
 *                 opacity 0.54.
 *
 * The preset's two paper-texture layer mixes are deliberately NOT here —
 * removed by design choice (they added little to the look).
 *
 * Deterministic: fixed-point pipeline, no extensions, generateMipmap's box
 * filter, and the in-shader dither is hash-based — same frame in, same pixels
 * out, in the live preview and the offline export.
 */

import {
  CURVE_POINTS,
  buildCurveLut,
  gradientLutPixels,
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
  vec3 rgb = texture(iChannel0, vec2(vUV.x, 1.0 - vUV.y)).rgb;   // flip at SAMPLE, not upload
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

/* --- P4a: the grain FIELD — the noise shader's fractal part, rendered into
 *         a cached texture. The field only depends on (resolution, grain
 *         size, chroma, film-frame offset), NOT on the picture — recomputing
 *         48 hash chains per pixel per FRAME was the chain's dominant cost,
 *         while the field itself changes at most 24×/sec (the film-frame
 *         clock) and never at grainSpeed 0 (the published still grain). The
 *         pass writes the raw chroma-mixed grain ([-1,1] → [0,1] encoding);
 *         the noise pass reads it back and keeps only the per-frame tone
 *         modulation. Same hash, same octaves, same constants — the pixels
 *         the field produces are identical to the old inline math. --- */
const FRAG_GRAINFIELD = COMMON + `
uniform vec2 iResolution;
uniform vec2 uGrainOffset;
uniform float grainSize;
uniform float chroma;
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
  float cell = max(grainSize, 0.5);
  float n  = fractalNoise(fragCoord, cell);
  float nR = fractalNoise(fragCoord + vec2(19.3, 37.7), cell);
  float nG = fractalNoise(fragCoord + vec2(73.1, 11.9), cell);
  float nB = fractalNoise(fragCoord + vec2(45.4, 62.3), cell);
  vec3 grain = mix(vec3(n), vec3(nR, nG, nB), chroma);   // [-1,1] per channel
  outColor = vec4(grain * 0.5 + 0.5, 1.0);               // encode for RGBA8
}`

/* --- P4b: noise (the verbatim tone modulation, grain from the cached field) --- */
const FRAG_NOISE = COMMON + `
uniform sampler2D iChannel0;
uniform sampler2D iGrain;     // cached field texture (the FRAG_GRAINFIELD output)
uniform float strength;
uniform float minGrain;
uniform float shadowWeight;
uniform float midWeight;
uniform float highlightWeight;
vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
void main() {
  vec3 texSrgb = texture(iChannel0, vUV).rgb;
  vec3 base = srgbToLinear(texSrgb);
  vec3 grain = texture(iGrain, vUV).rgb * 2.0 - 1.0;     // decode [-1,1]
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

/* --- P5: gradient map (Rec.709 luminance → editable gradient LUT, shifted /
 *         repeated / blend-moded like effect.app's own gradient-map node) --- */
const FRAG_GRADIENT = COMMON + `
uniform sampler2D iChannel0;
uniform sampler2D iLut;
uniform float uMix;
uniform float uShift;
uniform float uRepeat;
uniform int uBlend;
vec3 mapBlend(int mode, vec3 base, vec3 mapped) {
  if (mode == 1) return base * mapped;                       // multiply
  if (mode == 2) return 1.0 - (1.0 - base) * (1.0 - mapped); // screen
  if (mode == 3) {                                           // overlay
    // GLSL ES relational operators are SCALAR-only — 'base <= vec3(0.5)'
    // never compiled on strict drivers (ANGLE/Metal — i.e. every real
    // browser), the constructor threw, and the whole filter silently fell
    // back to the slow per-pixel CPU path FOREVER. lessThanEqual is the
    // vector-legal form: identical math, both branches agree at 0.5.
    return mix(
      1.0 - 2.0 * (1.0 - base) * (1.0 - mapped),
      2.0 * base * mapped,
      vec3(lessThanEqual(base, vec3(0.5)))
    );
  }
  if (mode == 4) return min(base + mapped, 1.0);             // add
  return mapped;                                              // normal
}
void main() {
  vec4 base = texture(iChannel0, vUV);
  float luminance = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
  // At the published defaults (repeat 1, shift 0) the lookup stays a plain
  // clamped luminance read — byte-identical to the preset's own map. Once the
  // user slides the window (shift) or tiles it (repeat), the coordinate wraps
  // so the ramp's ends re-enter from the other side (shadows can pick up the
  // bright end — the effect.app behavior).
  float t = (uShift == 0.0 && uRepeat == 1.0)
    ? luminance
    : fract(luminance * uRepeat + uShift);
  vec3 mapped = texture(iLut, vec2(t, 0.5)).rgb;
  vec3 blended = mapBlend(uBlend, base.rgb, mapped);
  outColor = vec4(mix(base.rgb, blended, uMix), base.a);
}`

/* --- P6: curves (apply mode L: setLuma(base, curvedLuma)) + node opacity —
 *         the final pass, drawn straight to the canvas --- */
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

/* --- P8: the split + strength mix, moved off the 2D context into the chain —
 *         the curves output vs the UNTOUCHED source frame (srcTex already
 *         holds it): below the split line the original fades back in through
 *         the same piecewise-linear ramp the 2D mask built (0 above p0, 0.5
 *         at the edge, 1 below p1), and the strength dial blends the whole
 *         look back toward the original at (1 − strength). One cheap pass
 *         replaces the per-frame full-canvas snapshot + mask copy + gradient
 *         fill + two composite draws the 2D path paid. --- */
const FRAG_SPLITMIX = COMMON + `
uniform sampler2D iFiltered;
uniform sampler2D iOriginal;
uniform float uSplitOn;
uniform float uEdge;      // 1 − split (the split line, measured from the TOP)
uniform float uSoft;      // 0.06 — the same fade width the 2D mask used
uniform float uStrength;
void main() {
  vec3 f = texture(iFiltered, vUV).rgb;
  // iOriginal (srcTex) is uploaded UNFLIPPED — the flip lives in the levels
  // sampler, so this pass applies the same sample-space flip to stay aligned
  // with the filtered orientation (see the constructor note).
  vec3 o = texture(iOriginal, vec2(vUV.x, 1.0 - vUV.y)).rgb;
  // the 2D mask's ramp — canvas gradients interpolate linearly between stops
  // measured from the top edge; vUV is display-upright (v=1 = the top), so
  // the gradient position is 1 − vUV.y. uSplitOn=0 → g=0 (no split part).
  float gradPos = 1.0 - vUV.y;
  float p0 = max(0.0, uEdge - uSoft);
  float p1 = min(1.0, uEdge + uSoft);
  float gs;
  if (gradPos <= p0) gs = 0.0;
  else if (gradPos <= uEdge) gs = 0.5 * (gradPos - p0) / max(uEdge - p0, 1e-6);
  else if (gradPos <= p1) gs = 0.5 + 0.5 * (gradPos - uEdge) / max(p1 - uEdge, 1e-6);
  else gs = 1.0;
  float g = gs * uSplitOn;
  vec3 x = mix(f, o, g);
  vec3 outCol = mix(x, o, 1.0 - uStrength);
  outColor = vec4(outCol, 1.0);
}`

/* ------------------------------ GL plumbing -------------------------------- */

type GlPass = {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3])

/** Adaptive internal-resolution ladder for the live preview: the EMA of the
 *  chain's measured cost steps DOWN one rung when a frame averages past the
 *  step threshold and climbs back one rung after ~2 s of cheap frames.
 *  Exports bypass the ladder (full scale, faithful frames). */
export const SCALE_LADDER = [1, 0.75, 0.5, 0.33]
export const STEP_DOWN_MS = 30
export const STEP_UP_MS = 12
export const STEP_UP_FRAMES = 120

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
  private grainTex: WebGLTexture | null = null
  private grainFb: WebGLFramebuffer | null = null
  private grainKey = ''
  private lutTexs = new Map<string, WebGLTexture>()
  private lastCurveKey = -1
  private lastGradKey = ''
  private lost = false

  constructor() {
    this.canvas = document.createElement('canvas')
    this.gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      // The GL canvas is consumed by a same-task drawImage right after the
      // chain renders (before the browser composites), so the drawing buffer
      // never needs to survive past the frame — preserving it cost a full
      // buffer copy per frame for nothing.
      preserveDrawingBuffer: false,
      // The filter is the heaviest thing on the page; on dual-GPU machines
      // 'low-power' pinned it to the integrated chip. Ask for the fast one —
      // the browser still honors battery savers over this hint.
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext
    if (!this.gl) throw new Error('no webgl2')
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    this.initGeometry()
    this.initLuts()
    // From here on, canvas-backed uploads (the source frame) go in UNFLIPPED.
    // The old UNPACK_FLIP_Y_WEBGL=true forced every canvas upload down the
    // slow CPU path (read back the canvas, flip it in JS/ Skia, re-upload) —
    // measured at ~16 ms per frame in the worst case, and it defeats the
    // GPU-to-GPU fast path on real hardware too. The flip now happens in the
    // SAMPLERS instead: WebGL textures put the first pixel row at v=0, so
    // without a flip the upload reads the picture upside down (v=0 = top).
    // The levels pass and the splitmix pass (the only two that touch the
    // source texture) negate vUV.y at sample time, which puts the picture
    // upright end to end — same pixels, none of the CPU cost. LUT uploads
    // are typed arrays (unaffected by sample-space flips).
    // The preset's gradient mask does NOT live in this display space: the
    // engine defines its mask frame Y-down (mask y=-1 = the image's TOP
    // edge) — measured off the site's own render of a calibrated
    // luminance-ramp (full invert to ~38% height, fade centered ~45%, gone
    // by ~55%) — so the levels shader negates vUV.y a SECOND time to enter
    // that frame, which is what puts the inversion band over the TOP of the
    // picture exactly where effect.app puts it.
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
    this.grainTex = null
    this.grainFb = null
    this.grainKey = ''
    this.lutTexs.clear()
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
    // gradient LUTs per ramp (preset quick-chips) + the EDITABLE map's own
    // LUT — re-uploaded whenever the stop set changes (gradKey)
    for (const ramp of ['violet', 'uv', 'acid', 'ember', 'ice']) {
      this.lutTexs.set('grad:' + ramp, this.makeLutTex(gradientLutPixels(ramp)))
    }
    this.lutTexs.set('grad:custom', this.makeLutTex(gradientLutPixels('violet')))
    this.lastGradKey = ''
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
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
      'grainfield',
      FRAG_GRAINFIELD,
      ['iResolution', 'uGrainOffset', 'grainSize', 'chroma'],
    )
    this.makePass(
      'noise',
      FRAG_NOISE,
      ['iChannel0', 'iGrain', 'strength', 'minGrain', 'shadowWeight', 'midWeight', 'highlightWeight'],
    )
    this.makePass('gradient', FRAG_GRADIENT, ['iChannel0', 'iLut', 'uMix', 'uShift', 'uRepeat', 'uBlend'])
    this.makePass('curves', FRAG_CURVES, ['iChannel0', 'iLut', 'uOpacity'])
    this.makePass(
      'splitmix',
      FRAG_SPLITMIX,
      ['iFiltered', 'iOriginal', 'uSplitOn', 'uEdge', 'uSoft', 'uStrength'],
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
    // three ping-pong buffers: A/B alternate the chain, C holds the curves
    // output when the split/strength mix pass runs after it (it samples that
    // result while drawing to the canvas — same-surface reads are illegal)
    for (let i = 0; i < 3; i++) {
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
    // the cached grain field — its own persistent texture + framebuffer so
    // the ping-pong passes can't clobber it mid-chain
    if (this.grainTex) gl.deleteTexture(this.grainTex)
    if (this.grainFb) gl.deleteFramebuffer(this.grainFb)
    this.grainTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.grainTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.grainFb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.grainFb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.grainTex, 0)
    this.grainKey = ''  // size changed → the field must re-render
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
    // NOTE: no gl.finish() here — the GL command stream already guarantees
    // a later pass reading this framebuffer's texture sees the finished
    // draw; finish() would only stall the CPU and serialize the pipeline.
  }

  /** Run the whole preset chain over the given 2D source; returns the GL
   *  canvas holding the finished frame (draw it onto the 2D context). Every
   *  effect parameter arrives already mapped from the config dials (0.5 = the
   *  published preset's own value where noted). grainOffsetX/Y shift the
   *  noise lattice per film-frame (animated grain — 0/0 is the published
   *  preset's still grain). scale < 1 renders the chain at a lower internal
   *  resolution (perf escape hatch for the live preview). split/strength are
   *  the two fade-back dials — applied INSIDE the chain (the splitmix pass
   *  reads the untouched srcTex), so the caller never copies the frame. */
  render(p: {
    source: HTMLCanvasElement
    bloomIntensity: number
    bloomThreshold: number
    bloomKnee: number
    bloomMix: number
    noiseStrength: number
    grainSize: number
    chroma: number
    shadowWeight: number
    highlightWeight: number
    mapMix: number
    curveMix: number
    curveLut: Float32Array
    /** The gradient map's LUT pixels (256×1 RGBA, built from the editable
     *  stops) + a signature — the texture re-uploads only when it changes. */
    gradPixels: Uint8Array
    gradKey: string
    /** Gradient shift (−1..1) and repeat (1..8) — the ramp window. */
    mapShift: number
    mapRepeat: number
    /** Blend mode: 0 normal, 1 multiply, 2 screen, 3 overlay, 4 add. */
    mapBlend: number
    grainOffsetX: number
    grainOffsetY: number
    /** The split line (0..1, 0 = no split) and the look's strength (0..1,
     *  1 = full). Both handled by the final splitmix pass. */
    split: number
    strength: number
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
    const P = (k: string) => this.passes.get(k)!

    const grainOn = p.noiseStrength > 0.001
    const bloomOn = p.bloomIntensity > 0.001 && p.bloomMix > 0.001
    const splitOn = p.split > 0.001
    const fadeOn = p.strength < 0.999
    const splitMixNeeded = splitOn || fadeOn

    // the grain field — re-render only when its inputs actually changed (the
    // film-frame offset moves ≤24×/sec and never at grainSpeed 0; every other
    // frame the noise pass just samples this texture)
    if (grainOn) {
      const key = `${this.w}x${this.h}|${p.grainSize.toFixed(3)}|${p.chroma.toFixed(3)}|${Math.round(p.grainOffsetX)}|${Math.round(p.grainOffsetY)}`
      if (this.grainKey !== key) {
        this.renderPass(P('grainfield'), this.grainFb, () => {
          gl.uniform2f(P('grainfield').uniforms.iResolution, this.w, this.h)
          gl.uniform2f(P('grainfield').uniforms.uGrainOffset, p.grainOffsetX, p.grainOffsetY)
          gl.uniform1f(P('grainfield').uniforms.grainSize, p.grainSize)
          gl.uniform1f(P('grainfield').uniforms.chroma, p.chroma)
        })
        this.grainKey = key
      }
    }

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

    // the gradient map's LUT follows the editable stops — re-upload on change
    if (this.lastGradKey !== p.gradKey) {
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexs.get('grad:custom')!)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.gradPixels)
      this.lastGradKey = p.gradKey
    }

    // upload the source frame (full-res, Y-flipped at upload — see the
    // constructor note on UNPACK_FLIP_Y_WEBGL)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, p.source)

    const aspect = w / h
    const A = this.fbos[0]
    const B = this.fbos[1]
    const C = this.fbos[2]

    // 1) levels (invert) behind the vertical smooth gradient mask  src → A
    this.renderPass(P('levels'), A.fb, () => {
      this.use(0, this.srcTex, P('levels').uniforms.iChannel0)
      gl.uniform2f(P('levels').uniforms.uCenter, 0.074, -0.094)
      gl.uniform1f(P('levels').uniforms.uWidth, 0.3)
      gl.uniform1f(P('levels').uniforms.uRotation, 90)
      gl.uniform1f(P('levels').uniforms.uAspect, aspect)
    })

    let cur = A
    const nxt = B

    if (bloomOn) {
      // 2) bloom-1 bright pass  A → B
      this.renderPass(P('bright'), nxt.fb, () => {
        this.use(0, cur.tex, P('bright').uniforms.iChannel0)
        gl.uniform1f(P('bright').uniforms.uThreshold, p.bloomThreshold)
        gl.uniform1f(P('bright').uniforms.uKnee, p.bloomKnee)
        gl.uniform1f(P('bright').uniforms.uIntensity, p.bloomIntensity)
      })
      // copy the bright pass into the mip pyramid (the engine uploads the
      // bright pass as a texture and runs generateMipmap)
      gl.bindFramebuffer(gl.FRAMEBUFFER, nxt.fb)
      gl.bindTexture(gl.TEXTURE_2D, this.pyramid)
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.w, this.h)
      gl.generateMipmap(gl.TEXTURE_2D)

      // 3) bloom-3: 6-LOD average × the mix dial, screened over the levels output  → B
      this.renderPass(P('bloom'), nxt.fb, () => {
        this.use(0, this.pyramid, P('bloom').uniforms.iPyramid)
        this.use(1, cur.tex, P('bloom').uniforms.iBase)
        gl.uniform1f(P('bloom').uniforms.uBloomFactor, p.bloomMix)
      })
      cur = nxt
    }

    if (grainOn) {
      // 4) film grain — tone modulation over the cached field  cur → other
      const dst = cur === A ? B : A
      this.renderPass(P('noise'), dst.fb, () => {
        this.use(0, cur.tex, P('noise').uniforms.iChannel0)
        this.use(1, this.grainTex, P('noise').uniforms.iGrain)
        gl.uniform1f(P('noise').uniforms.strength, p.noiseStrength)
        gl.uniform1f(P('noise').uniforms.minGrain, 0.14)
        gl.uniform1f(P('noise').uniforms.shadowWeight, p.shadowWeight)
        gl.uniform1f(P('noise').uniforms.midWeight, 0.4)
        gl.uniform1f(P('noise').uniforms.highlightWeight, p.highlightWeight)
      })
      cur = dst
    }

    // 5) gradient map — the editable gradient, shift/repeat/blend + opacity  cur → other
    {
      const dst = cur === A ? B : A
      this.renderPass(P('gradient'), dst.fb, () => {
        this.use(0, cur.tex, P('gradient').uniforms.iChannel0)
        this.use(1, this.lutTexs.get('grad:custom')!, P('gradient').uniforms.iLut)
        gl.uniform1f(P('gradient').uniforms.uMix, p.mapMix)
        gl.uniform1f(P('gradient').uniforms.uShift, p.mapShift)
        gl.uniform1f(P('gradient').uniforms.uRepeat, p.mapRepeat)
        gl.uniform1i(P('gradient').uniforms.uBlend, p.mapBlend)
      })
      cur = dst
    }

    // 6) curves — apply mode L + node opacity 0.54  cur → (C | canvas)
    //    (the preset's two paper layer mixes were removed by design)
    if (splitMixNeeded) {
      this.renderPass(P('curves'), C.fb, () => {
        this.use(0, cur.tex, P('curves').uniforms.iChannel0)
        this.use(1, this.lutTexs.get('curve')!, P('curves').uniforms.iLut)
        gl.uniform1f(P('curves').uniforms.uOpacity, 0.54)
      })

      // 7) the split + strength mix against the UNTOUCHED source  C → canvas
      this.renderPass(P('splitmix'), null, () => {
        this.use(0, C.tex, P('splitmix').uniforms.iFiltered)
        this.use(1, this.srcTex, P('splitmix').uniforms.iOriginal)
        gl.uniform1f(P('splitmix').uniforms.uSplitOn, splitOn ? 1 : 0)
        gl.uniform1f(P('splitmix').uniforms.uEdge, 1 - Math.min(1, Math.max(0, p.split)))
        gl.uniform1f(P('splitmix').uniforms.uSoft, 0.06)
        gl.uniform1f(P('splitmix').uniforms.uStrength, Math.min(1, Math.max(0, p.strength)))
      })
    } else {
      this.renderPass(P('curves'), null, () => {
        this.use(0, cur.tex, P('curves').uniforms.iChannel0)
        this.use(1, this.lutTexs.get('curve')!, P('curves').uniforms.iLut)
        gl.uniform1f(P('curves').uniforms.uOpacity, 0.54)
      })
    }

    return this.canvas
  }
}

/**
 * Halation GL chain — the effect.app Halation effect's own four GLSL passes,
 * ported verbatim from the decrypted shaders the site serves its editor
 * (/effects/halation-1..4.glsl, decrypted with the same pipeline the editor
 * runs: base64 → AES-GCM → gunzip). Nothing here is eyeballed.
 *
 *   Pass 1 (halation-1) — bright pass: the frame's linear-light Rec.709
 *   luminance through a soft-knee threshold, scaled by 0.4 + boost·1.8 into
 *   the glow energy channel.
 *   Pass 2 (halation-2) — horizontal diffusion: the energy blurs at TWO
 *   radii (a fraction of the frame width) — tight "local" + wide "global".
 *   Pass 3 (halation-3) — vertical diffusion: same two radii the other
 *   axis, so the pair becomes two separable blurs (local and global).
 *   Pass 4 (halation-4) — composite: the tight glow tints red → orange by
 *   how hot it burns (hue dial + boost), the wide halo stays red at half
 *   strength, everything screens back over the original in linear light
 *   behind a background gate (dark-only ↔ everywhere) and a blue damper.
 *
 * The blur is the site's own capped 80-tap sweep (step = max(1, radius/80),
 * quadratic-smoothed linear weights), sampled with CLAMP_TO_EDGE so halos
 * stop at the frame edge instead of wrapping around it.
 *
 * The site's shaders carry a "window" system (iSrcResolution /
 * iWindowOffset / iWindowSize) for masking the effect to a sub-region —
 * Spectra has no masking, so the shaders' own no-window branch (winActive()
 * false) is the path ported here; the math is otherwise byte-identical.
 *
 * Architecture mirrors neon-split-gl.ts: one offscreen WebGL2 canvas, full-
 * frame quads, RGBA8 FBOs, the source frame uploaded per render() call.
 * `scale` < 1 renders the chain at lower internal resolution — the live
 * preview's perf escape hatch; exports always call with 1.
 */

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

/* --- P1: bright pass (halation-1, verbatim; the sRGB/Oklab helpers the
 *         file carries are its shared boilerplate — only the sRGB pair and
 *         the Rec.709 luminance are used by this pass) --- */
const FRAG_BRIGHT = COMMON + `
uniform sampler2D iChannel0;
uniform float uThreshold;
uniform float uKnee;
uniform float uBoost;

vec3 sRGBToLinear(vec3 c) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(0.04045, c));
}

float luminance(vec3 col) { return dot(col, vec3(0.2126729, 0.7151522, 0.0721750)); }

float softKnee(float y, float t, float k) {
    float x = max(y - (t - k), 0.0);
    return clamp((x * x) / (4.0 * k * x + 1e-6), 0.0, 1.0);
}

void main() {
    vec2 uv = vUV;
    vec3 lin = sRGBToLinear(texture(iChannel0, uv).rgb);
    float y = luminance(lin);
    float src = softKnee(y, uThreshold, max(0.02, uKnee));
    float energy = src * (0.4 + uBoost * 1.8);

    outColor = vec4(energy, 0.0, 0.0, 1.0);
}`

/* --- P2: horizontal diffusion (halation-2, verbatim no-window path). The
 *         site runs this shader with the blur radii as uniforms shared with
 *         P3; both radii read the SAME energy channel here, so the pass
 *         packs local → R and global → G. --- */
const FRAG_BLUR_H = COMMON + `
uniform sampler2D iChannel0;
uniform vec2 iResolution;
uniform float uLocalDiffusion;
uniform float uGlobalDiffusion;

void main() {
    vec2 uv = vUV;
    float srcResX = iResolution.x;

    float center = texture(iChannel0, uv).r;

    // blurHorizontal(uv, localDiffusion, channel R, disabled = center)
    float local = center;
    {
        float blurPixels = uLocalDiffusion * srcResX;
        if (uLocalDiffusion > 0.0 && blurPixels >= 1.0) {
            float stepPx = max(1.0, blurPixels / 80.0);
            float sum = center;
            float wsum = 1.0;
            for (float dist = stepPx; dist < blurPixels; dist += stepPx) {
                float t = dist / blurPixels;
                float w = 1.0 - t;
                w = 1.0 - w * w;
                w = 1.0 - w * w;
                vec2 offset = vec2(dist / srcResX, 0.0);
                sum += w * (
                    texture(iChannel0, uv + offset).r +
                    texture(iChannel0, uv - offset).r
                );
                wsum += w * 2.0;
            }
            local = sum / wsum;
        }
    }

    // blurHorizontal(uv, globalDiffusion, channel R, disabled = 0.0)
    float global = 0.0;
    {
        float blurPixels = uGlobalDiffusion * srcResX;
        if (uGlobalDiffusion > 0.0 && blurPixels >= 1.0) {
            float stepPx = max(1.0, blurPixels / 80.0);
            float sum = center;
            float wsum = 1.0;
            for (float dist = stepPx; dist < blurPixels; dist += stepPx) {
                float t = dist / blurPixels;
                float w = 1.0 - t;
                w = 1.0 - w * w;
                w = 1.0 - w * w;
                vec2 offset = vec2(dist / srcResX, 0.0);
                sum += w * (
                    texture(iChannel0, uv + offset).r +
                    texture(iChannel0, uv - offset).r
                );
                wsum += w * 2.0;
            }
            global = sum / wsum;
        }
    }

    outColor = vec4(local, global, 0.0, 1.0);
}`

/* --- P3: vertical diffusion (halation-3, verbatim no-window path): the
 *         tight glow reads the H-blurred local (R), the wide halo reads the
 *         H-blurred global (G). --- */
const FRAG_BLUR_V = COMMON + `
uniform sampler2D iChannel0;
uniform vec2 iResolution;
uniform float uLocalDiffusion;
uniform float uGlobalDiffusion;

void main() {
    vec2 uv = vUV;
    float srcResY = iResolution.y;

    vec4 here = texture(iChannel0, uv);
    float centerR = here.r;
    float centerG = here.g;

    // blurVertical(uv, localDiffusion, channel R, disabled = center R)
    float local = centerR;
    {
        float blurPixels = uLocalDiffusion * srcResY;
        if (uLocalDiffusion > 0.0 && blurPixels >= 1.0) {
            float stepPx = max(1.0, blurPixels / 80.0);
            float sum = centerR;
            float wsum = 1.0;
            for (float dist = stepPx; dist < blurPixels; dist += stepPx) {
                float t = dist / blurPixels;
                float w = 1.0 - t;
                w = 1.0 - w * w;
                w = 1.0 - w * w;
                vec2 offset = vec2(0.0, dist / srcResY);
                sum += w * (
                    texture(iChannel0, uv + offset).r +
                    texture(iChannel0, uv - offset).r
                );
                wsum += w * 2.0;
            }
            local = sum / wsum;
        }
    }

    // blurVertical(uv, globalDiffusion, channel G, disabled = 0.0)
    float global = 0.0;
    {
        float blurPixels = uGlobalDiffusion * srcResY;
        if (uGlobalDiffusion > 0.0 && blurPixels >= 1.0) {
            float stepPx = max(1.0, blurPixels / 80.0);
            float sum = centerG;
            float wsum = 1.0;
            for (float dist = stepPx; dist < blurPixels; dist += stepPx) {
                float t = dist / blurPixels;
                float w = 1.0 - t;
                w = 1.0 - w * w;
                w = 1.0 - w * w;
                vec2 offset = vec2(0.0, dist / srcResY);
                sum += w * (
                    texture(iChannel0, uv + offset).g +
                    texture(iChannel0, uv - offset).g
                );
                wsum += w * 2.0;
            }
            global = sum / wsum;
        }
    }

    outColor = vec4(local, global, 0.0, 1.0);
}`

/* --- P4: composite (halation-4, verbatim — iChannel7 is the original
 *         source frame in the site's engine; texture unit 1 here) --- */
const FRAG_COMPOSITE = COMMON + `
uniform sampler2D iChannel0;
uniform sampler2D iChannel7;
uniform float uIntensity;
uniform float uHue;
uniform float uBackgroundGain;
uniform float uBlueComp;
uniform float uBoost;

vec3 sRGBToLinear(vec3 c) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(0.04045, c));
}

vec3 linearTosRGB(vec3 c) {
    c = max(c, vec3(0.0));
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(0.0031308, c));
}

float luminance(vec3 col) { return dot(col, vec3(0.2126729, 0.7151522, 0.0721750)); }

void main() {
    vec2 uv = vUV;
    vec2 glow = texture(iChannel0, uv).rg;
    vec4 original = texture(iChannel7, uv);
    vec3 base = sRGBToLinear(original.rgb);
    float bgY = luminance(base);

    float energy = clamp(glow.r * 3.0, 0.0, 1.0);
    vec3 red = vec3(1.0, 0.0, 0.0);
    vec3 orange = vec3(1.0, 0.45, 0.06);
    float greenSensitivity = clamp(uHue + uBoost * 0.4, 0.0, 1.0);
    vec3 localTint = mix(red, orange, energy * greenSensitivity);

    vec3 halo = localTint * glow.r + red * glow.g * 0.5;

    float darkOnly = 1.0 - smoothstep(0.0, 0.5, bgY);
    float bgGate = mix(darkOnly, 1.0, uBackgroundGain);

    float blueBg = max(0.0, base.b - bgY);
    float blueDamp = 1.0 - blueBg * (1.0 - uBlueComp);

    halo *= bgGate * blueDamp * uIntensity;

    vec3 result = 1.0 - (1.0 - base) * (1.0 - halo);
    outColor = vec4(linearTosRGB(result), original.a);
}`

/* ------------------------------ GL plumbing -------------------------------- */

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3])

type GlPass = {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

export type HalationParams = {
  source: HTMLCanvasElement
  threshold: number
  knee: number
  boost: number
  localDiffusion: number
  globalDiffusion: number
  intensity: number
  hue: number
  backgroundGain: number
  blueComp: number
  scale: number
}

export class HalationGL {
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
  private srcTex: WebGLTexture | null = null
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
    // The source frame uploads Y-flipped (WebGL puts texture row 0 at v=0;
    // without the flip every pass samples the picture upside down — the
    // same note neon-split's chain carries).
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true)
    this.compileAll()
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost()
  }

  dispose(): void {
    try {
      this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* already lost */
    }
    this.passes.clear()
    this.fbos = []
    this.srcTex = null
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
    this.makePass('bright', FRAG_BRIGHT, ['iChannel0', 'uThreshold', 'uKnee', 'uBoost'])
    this.makePass('blurH', FRAG_BLUR_H, ['iChannel0', 'iResolution', 'uLocalDiffusion', 'uGlobalDiffusion'])
    this.makePass('blurV', FRAG_BLUR_V, ['iChannel0', 'iResolution', 'uLocalDiffusion', 'uGlobalDiffusion'])
    this.makePass('composite', FRAG_COMPOSITE, [
      'iChannel0',
      'iChannel7',
      'uIntensity',
      'uHue',
      'uBackgroundGain',
      'uBlueComp',
      'uBoost',
    ])
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
    this.w = w
    this.h = h
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

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

  private renderPass(pass: GlPass, target: WebGLFramebuffer | null, setUniforms: () => void) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(pass.program)
    setUniforms()
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  /** Run the whole halation chain over the given 2D source; returns the GL
   *  canvas holding the finished frame (draw it onto the 2D context). Every
   *  parameter arrives already clamped to the shader's own published range.
   *  scale < 1 renders the chain at a lower internal resolution (perf
   *  escape hatch for the live preview). */
  render(p: HalationParams): HTMLCanvasElement {
    const gl = this.gl
    const w = p.source.width
    const h = p.source.height
    if (gl.isContextLost() || this.lost) throw new Error('gl lost')
    this.ensureSrcSize(w, h)
    const rw = Math.max(8, Math.round(w * p.scale))
    const rh = Math.max(8, Math.round(h * p.scale))
    this.ensureSize(rw, rh)

    // upload the source frame (full-res, Y-flipped at upload)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, p.source)

    const A = this.fbos[0]
    const B = this.fbos[1]
    const C = this.fbos[2]
    const P = (k: string) => this.passes.get(k)!

    // 1) bright pass  src → A
    this.renderPass(P('bright'), A.fb, () => {
      this.use(0, this.srcTex, P('bright').uniforms.iChannel0)
      gl.uniform1f(P('bright').uniforms.uThreshold, p.threshold)
      gl.uniform1f(P('bright').uniforms.uKnee, p.knee)
      gl.uniform1f(P('bright').uniforms.uBoost, p.boost)
    })

    // 2) horizontal diffusion  A → B (R = local H, G = global H)
    this.renderPass(P('blurH'), B.fb, () => {
      this.use(0, A.tex, P('blurH').uniforms.iChannel0)
      gl.uniform2f(P('blurH').uniforms.iResolution, this.w, this.h)
      gl.uniform1f(P('blurH').uniforms.uLocalDiffusion, p.localDiffusion)
      gl.uniform1f(P('blurH').uniforms.uGlobalDiffusion, p.globalDiffusion)
    })

    // 3) vertical diffusion  B → C (R = local HV, G = global HV)
    this.renderPass(P('blurV'), C.fb, () => {
      this.use(0, B.tex, P('blurV').uniforms.iChannel0)
      gl.uniform2f(P('blurV').uniforms.iResolution, this.w, this.h)
      gl.uniform1f(P('blurV').uniforms.uLocalDiffusion, p.localDiffusion)
      gl.uniform1f(P('blurV').uniforms.uGlobalDiffusion, p.globalDiffusion)
    })

    // 4) composite over the original  C + src → canvas (final pass)
    this.renderPass(P('composite'), null, () => {
      this.use(0, C.tex, P('composite').uniforms.iChannel0)
      this.use(1, this.srcTex, P('composite').uniforms.iChannel7)
      gl.uniform1f(P('composite').uniforms.uIntensity, p.intensity)
      gl.uniform1f(P('composite').uniforms.uHue, p.hue)
      gl.uniform1f(P('composite').uniforms.uBackgroundGain, p.backgroundGain)
      gl.uniform1f(P('composite').uniforms.uBlueComp, p.blueComp)
      gl.uniform1f(P('composite').uniforms.uBoost, p.boost)
    })

    return this.canvas
  }
}

/**
 * MacPaint GL — effect.app's MacPaint effect's own shader, ported VERBATIM
 * from the decrypted bundle (/effects/all-shaders.bin, AES-GCM keyed by
 * SHA-256 of effects.json, SHD1 container → 471-line GLSL) onto one WebGL2
 * full-frame pass. This is the answer to bitmap width 4096: the shader's
 * cost is per OUTPUT PIXEL (the grid `g = floor(srcPx / cell)` is implicit,
 * recomputed per fragment — the dial never changes the fragment count), so
 * the GPU prints 4096 exactly as cheaply as 32, the same way the site does.
 * The CPU port in dither-filter.ts stays the fallback (its interactivity
 * budget caps the grid), but on any real GPU the dial runs verbatim.
 *
 * What the shader actually does, cell by cell — the decrypted mainImage,
 * line for line:
 *   · area-average the picture at 4 rotated offsets inside each cell
 *   · optional unsharp over the cell grid (Sharpen, negative denoises)
 *   · Rec.709 luma → optional flattest-diagonal-quadrant variance pick
 *     (Smooth — flattens noise into even tone, keeping edges) with the
 *     sharpen detail layered back on top
 *   · optional Sobel edges (Ink stamps solid ink along contours, Shade
 *     pushes them toward paper)
 *   · threshold/contrast pivot → ink coverage 0..1
 *   · optional hash-grain jitter on the coverage
 *   · pick the ENABLED pattern whose measured ink coverage best matches
 *     (38 hand-crafted 8×8 MacPaint bitmap screens, table verbatim)
 *   · print the pattern's bit in ink or paper, blended over the frame
 *
 * Strictly TWO colors — `mix(paper_color, ink_color, bit)`: the greys the
 * eye reads in a fine MacPaint print are the mid-density screens themselves
 * (the 50% checkerboards and dense hatches) blending at small cell sizes,
 * not a third ink. The site's window system (iSrcResolution / iWindowOffset
 * / iWindowSize masking) is stripped — Spectra has no masking, so the
 * shader's own no-window branch is the path ported here; the math is
 * otherwise byte-identical. `blend` is the dither Strength dial (the
 * untouched frame fades back through below 1, same semantics as the CPU
 * path's composite).
 *
 * Architecture mirrors halation-gl.ts: one offscreen WebGL2 canvas, one
 * full-frame quad, the composed frame uploaded per render() at full
 * resolution, the finished print returned as the GL canvas (drawImage it
 * onto the 2D context). A construction-time SELF-TEST pushes a split
 * black/white probe through the real program and requires BOTH the ink and
 * the paper color to land in the framebuffer — some GL stacks hand out
 * program objects that link, validate and report no errors yet silently
 * draw nothing; the probe recompiles up to 3 times and throws so the proven
 * CPU fallback takes over (the sandbox's software stack fails it on cue).
 */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D iChannel0;  // the composed frame, uploaded Y-flipped
uniform vec2  iResolution;    // canvas size, px

uniform int slots;            // bitmask of enabled patterns, slots 0-18
uniform int slots_hi;         // bitmask of enabled patterns, slots 19-37
uniform float bitmap_width;   // cells along the LONGER frame side

uniform float threshold;      // the tone the 50% density pivot sits at
uniform float contrast;       // how hard tones snap across the pivot
uniform float grain;          // per-cell coverage jitter (deterministic hash)

uniform float smoothing;      // flatten noise into even tone, keeping edges
uniform float sharpen;        // unsharp over the cell grid; negative denoises
uniform float radius;         // the sharpen stencil reach, cells

uniform int edge_mode;        // 0 off | 1 ink | 2 shade
uniform float edge_threshold;
uniform float edge_width;

uniform vec3 ink_color;
uniform vec3 paper_color;
uniform float blend;          // the dither Strength dial

const int MP_SLOTS = 38;
const int MP_SLOT_BITS = 19;

const uvec2 MP_PATTERN[38] = uvec2[38](
    uvec2(0x00000000u, 0x00000000u),
    uvec2(0x80000000u, 0x00000000u),
    uvec2(0x80000800u, 0x80000800u),
    uvec2(0x80402000u, 0x02040800u),
    uvec2(0x40A00000u, 0x040A0000u),
    uvec2(0x80100220u, 0x01084004u),
    uvec2(0x88002200u, 0x88002200u),
    uvec2(0x01020408u, 0x10204080u),
    uvec2(0xAA008000u, 0x88008000u),
    uvec2(0x081C22C1u, 0x80010204u),
    uvec2(0x03844830u, 0x0C020101u),
    uvec2(0x20508888u, 0x88880502u),
    uvec2(0x88142241u, 0x8800AA00u),
    uvec2(0x82443944u, 0x82010101u),
    uvec2(0xFF808080u, 0x80808080u),
    uvec2(0x88888888u, 0x88888888u),
    uvec2(0x55A04040u, 0x550A0404u),
    uvec2(0x88228822u, 0x88228822u),
    uvec2(0xAA00AA00u, 0xAA00AA00u),
    uvec2(0x11224488u, 0x11224488u),
    uvec2(0xFF000000u, 0xFF000000u),
    uvec2(0x0008142Au, 0x552A1408u),
    uvec2(0x8080413Eu, 0x080814E3u),
    uvec2(0x102054AAu, 0xFF020408u),
    uvec2(0xFF808080u, 0xFF080808u),
    uvec2(0xB130031Bu, 0xD8C00C8Du),
    uvec2(0xFF888888u, 0xFF888888u),
    uvec2(0xF8742247u, 0x8F172271u),
    uvec2(0xAA55AA55u, 0xAA55AA55u),
    uvec2(0xAAAAAAAAu, 0xAAAAAAAAu),
    uvec2(0xFF00FF00u, 0xFF00FF00u),
    uvec2(0xBF00BFBFu, 0xB0B0B0B0u),
    uvec2(0x77898F8Fu, 0x7798F8F8u),
    uvec2(0xDD77DD77u, 0xDD77DD77u),
    uvec2(0x55FF55FFu, 0x55FF55FFu),
    uvec2(0xEEDDBB77u, 0xEEDDBB77u),
    uvec2(0xDDFF77FFu, 0xDDFF77FFu),
    uvec2(0xFFFFFFFFu, 0xFFFFFFFFu)
);

const float MP_DENSITY[38] = float[38](
    0.00000, 0.01562, 0.06250, 0.09375, 0.09375, 0.12500, 0.12500, 0.12500, 0.12500, 0.20312,
    0.20312, 0.21875, 0.21875, 0.23438, 0.23438, 0.25000, 0.25000, 0.25000, 0.25000, 0.25000,
    0.25000, 0.25000, 0.28125, 0.31250, 0.34375, 0.37500, 0.43750, 0.46875, 0.50000, 0.50000,
    0.50000, 0.51562, 0.59375, 0.75000, 0.75000, 0.75000, 0.87500, 1.00000
);

float luma709(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }

uint mpRow(uvec2 pattern, int y) {
    uint word = y < 4 ? pattern.x : pattern.y;
    return (word >> uint((3 - (y & 3)) * 8)) & 0xFFu;
}

bool mpEnabled(ivec2 mask, int slot) {
    int bits = slot < MP_SLOT_BITS ? mask.x : mask.y;
    int bit = slot < MP_SLOT_BITS ? slot : slot - MP_SLOT_BITS;
    return ((bits >> bit) & 1) == 1;
}

int mpSlotFor(ivec2 mask, float coverage) {
    float best = 1e9;
    int slot = 0;
    for (int i = 0; i < MP_SLOTS; i++) {
        if (mpEnabled(mask, i)) {
            float e = abs(MP_DENSITY[i] - coverage);
            if (e < best) { best = e; slot = i; }
        }
    }
    return slot;
}

int mpCount(ivec2 mask) {
    int n = 0;
    for (int i = 0; i < MP_SLOTS; i++) n += mpEnabled(mask, i) ? 1 : 0;
    return n;
}

float mpBit(int slot, ivec2 cell) {
    uint row = mpRow(MP_PATTERN[slot], cell.y);
    return float((row >> uint(7 - cell.x)) & 1u);
}

float mpCellLuma(vec2 g, float cell) {
    return luma709(texture(iChannel0, (g + 0.5) * cell / iResolution).rgb);
}

const int MP_MAX_SMOOTH = 3;
const float MP_EDGE_SOFT = 0.25;

float mpSmoothLuma(vec2 g, float cell, int r) {
    float best = 1e9;
    float flattest = 0.0;

    for (int q = 0; q < 4; q++) {
        vec2 dir = vec2(q == 0 || q == 3 ? -1.0 : 1.0, q < 2 ? -1.0 : 1.0);

        float sum = 0.0;
        float sumSq = 0.0;
        float n = 0.0;

        for (int j = 0; j <= MP_MAX_SMOOTH; j++) {
            if (j > r) break;
            for (int i = 0; i <= MP_MAX_SMOOTH; i++) {
                if (i > r) break;
                float v = mpCellLuma(g + vec2(float(i), float(j)) * dir, cell);
                sum += v;
                sumSq += v * v;
                n += 1.0;
            }
        }

        float mean = sum / n;
        float variance = abs(sumSq / n - mean * mean);
        if (variance < best) { best = variance; flattest = mean; }
    }

    return flattest;
}

float mpEdge(vec2 g, float cell, float w) {
    float tl = mpCellLuma(g + vec2(-w, -w), cell);
    float tm = mpCellLuma(g + vec2(0.0, -w), cell);
    float tr = mpCellLuma(g + vec2( w, -w), cell);
    float ml = mpCellLuma(g + vec2(-w, 0.0), cell);
    float mr = mpCellLuma(g + vec2( w, 0.0), cell);
    float bl = mpCellLuma(g + vec2(-w,  w), cell);
    float bm = mpCellLuma(g + vec2(0.0,  w), cell);
    float br = mpCellLuma(g + vec2( w,  w), cell);

    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (bl + 2.0 * bm + br) - (tl + 2.0 * tm + tr);

    return length(vec2(gx, gy)) * 0.1767767;
}

// The site's hash12 — grain jitter, fully deterministic.
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    // the shader's no-window branch: the whole frame is the source
    vec2 srcRes = iResolution;
    vec2 srcPx = vUV * iResolution;

    float cell = max(max(srcRes.x, srcRes.y) / max(bitmap_width, 1.0), 1e-4);
    vec2 g = floor(srcPx / cell);
    vec2 c = (g + 0.5) * cell;

    // the rotated 4-tap area average inside the cell
    float o = cell;
    vec3 t0 = texture(iChannel0, (c + vec2( 0.125,  0.375) * o) / srcRes).rgb;
    vec3 t1 = texture(iChannel0, (c + vec2( 0.375, -0.125) * o) / srcRes).rgb;
    vec3 t2 = texture(iChannel0, (c + vec2(-0.125, -0.375) * o) / srcRes).rgb;
    vec3 t3 = texture(iChannel0, (c + vec2(-0.375,  0.125) * o) / srcRes).rgb;
    vec3 cellRgb = (t0 + t1 + t2 + t3) * 0.25;

    vec3 flatRgb = cellRgb;
    if (sharpen != 0.0) {
        vec3 blur = vec3(0.0);
        float wsum = 0.0;
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
                vec2 q = (g + vec2(float(i), float(j)) * radius + 0.5) * cell;
                blur += w * texture(iChannel0, q / srcRes).rgb;
                wsum += w;
            }
        }
        cellRgb += sharpen * (cellRgb - blur / wsum);
    }
    cellRgb = clamp(cellRgb, 0.0, 1.0);

    float y = luma709(cellRgb);

    int smoothRadius = int(clamp(smoothing, 0.0, float(MP_MAX_SMOOTH)));
    if (smoothRadius > 0) {
        float detail = y - luma709(flatRgb);
        y = clamp(mpSmoothLuma(g, cell, smoothRadius) + detail, 0.0, 1.0);
    }

    float edge = edge_mode == 0 ? 0.0 : mpEdge(g, cell, max(edge_width, 0.0));

    if (edge_mode == 2) {
        y *= 1.0 - smoothstep(edge_threshold, edge_threshold + MP_EDGE_SOFT, edge);
    }

    float t = clamp((y - threshold) * contrast + 0.5, 0.0, 1.0);

    int all = (1 << MP_SLOT_BITS) - 1;
    ivec2 mask = ivec2(slots, slots_hi) & all;
    if (mask == ivec2(0)) mask = ivec2(all, (1 << (MP_SLOTS - MP_SLOT_BITS)) - 1);

    float coverage = 1.0 - t;
    if (grain != 0.0) {
        float n = float(mpCount(mask));
        coverage += grain * (hash12(g + 0.5) - 0.5) / max(n - 1.0, 1.0);
    }

    float bit = mpBit(mpSlotFor(mask, coverage), ivec2(mod(g, 8.0)));

    if (edge_mode == 1) bit = max(bit, step(edge_threshold, edge));

    vec4 base = texture(iChannel0, vUV);
    vec3 mac = mix(paper_color, ink_color, bit);

    outColor = vec4(mix(base.rgb, mac, clamp(blend, 0.0, 1.0)), base.a);
}`

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3])

type MacPass = {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

export type MacpaintParams = {
  /** The composed frame (drawn back onto by the caller) */
  source: HTMLCanvasElement
  /** Enabled pattern bitmask, slots 0..18 / 19..37 (0/0 = the shader's all rule) */
  slotsLo: number
  slotsHi: number
  /** Cells along the longer frame side, 32..4096 — printed verbatim */
  bitmapWidth: number
  threshold: number
  contrast: number
  grain: number
  smoothing: number
  sharpen: number
  radius: number
  edgeMode: number
  edgeThreshold: number
  edgeWidth: number
  /** Ink / paper in sRGB 0..1 (the shader takes them straight) */
  ink: [number, number, number]
  paper: [number, number, number]
  /** The dither Strength dial — the untouched frame fades back through */
  blend: number
}

export class MacpaintGL {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement
  private srcW = 0
  private srcH = 0
  private srcTex: WebGLTexture | null = null
  private quadVao: WebGLVertexArrayObject | null = null
  private quadBuf: WebGLBuffer | null = null
  private pass: MacPass | null = null
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
    // the same convention halation's chain runs — the composite lands
    // upright when drawn back onto the 2D canvas).
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true)
    this.compile()
    this.selfTest()
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

  private compile() {
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
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('program link: ' + gl.getProgramInfoLog(program))
    }
    const names = [
      'iChannel0',
      'iResolution',
      'slots',
      'slots_hi',
      'bitmap_width',
      'threshold',
      'contrast',
      'grain',
      'smoothing',
      'sharpen',
      'radius',
      'edge_mode',
      'edge_threshold',
      'edge_width',
      'ink_color',
      'paper_color',
      'blend',
    ]
    const uniforms: Record<string, WebGLUniformLocation | null> = {}
    for (const n of names) uniforms[n] = gl.getUniformLocation(program, n)
    this.pass = { program, uniforms }
  }

  /**
   * Construction-time self-test: a left-black / right-white probe through
   * the REAL program must land BOTH the ink color (black cells → coverage
   * 1 → the solid-ink screen) and the paper color (white cells → coverage
   * 0 → the empty screen). Recompiles up to 3 times (fresh program objects
   * draw reliably even on stacks whose first batch breaks) and throws so
   * the CPU fallback takes over — the software-rasterizer stacks that link
   * yet draw nothing fail exactly here.
   */
  private selfTest(): void {
    const gl = this.gl
    const T = 16
    const probe = document.createElement('canvas')
    probe.width = T
    probe.height = T
    const pctx = probe.getContext('2d')!
    pctx.fillStyle = '#000000'
    pctx.fillRect(0, 0, T, T)
    pctx.fillStyle = '#ffffff'
    pctx.fillRect(T / 2, 0, T / 2, T)

    // Two separate textures: the probe uploads into the SAMPLER texture and
    // the draw lands in its own framebuffer texture — sampling a texture
    // attached to the current draw framebuffer is a WebGL feedback loop
    // that strict implementations reject outright.
    const sampleTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, sampleTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, T, T, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, probe)
    const outTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, outTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, T, T, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0)

    const attempt = (): boolean => {
      const P = this.pass!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.viewport(0, 0, T, T)
      gl.useProgram(P.program)
      gl.bindVertexArray(this.quadVao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sampleTex)
      gl.uniform1i(P.uniforms.iChannel0, 0)
      gl.uniform2f(P.uniforms.iResolution, T, T)
      gl.uniform1i(P.uniforms.slots, 0x7ffff)
      gl.uniform1i(P.uniforms.slots_hi, 0x7ffff)
      gl.uniform1f(P.uniforms.bitmap_width, 4) // 4×4 cells: left half ink, right half paper
      gl.uniform1f(P.uniforms.threshold, 0.5)
      gl.uniform1f(P.uniforms.contrast, 4)
      gl.uniform1f(P.uniforms.grain, 0)
      gl.uniform1f(P.uniforms.smoothing, 0)
      gl.uniform1f(P.uniforms.sharpen, 0)
      gl.uniform1f(P.uniforms.radius, 1.2)
      gl.uniform1i(P.uniforms.edge_mode, 0)
      gl.uniform1f(P.uniforms.edge_threshold, 0.1)
      gl.uniform1f(P.uniforms.edge_width, 1.1)
      gl.uniform3f(P.uniforms.ink_color, 0.06, 0.06, 0.07)
      gl.uniform3f(P.uniforms.paper_color, 0.97, 0.96, 0.92)
      gl.uniform1f(P.uniforms.blend, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (gl.getError() !== gl.NO_ERROR) return false
      const px = new Uint8Array(T * T * 4)
      gl.readPixels(0, 0, T, T, gl.RGBA, gl.UNSIGNED_BYTE, px)
      // both inks must land: ≈ (15,15,18) from the solid-ink screen over the
      // black half, ≈ (247,245,235) from the empty screen over the white half
      let inkPx = 0
      let paperPx = 0
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] < 60 && px[i + 1] < 60) inkPx++
        if (px[i] > 200 && px[i + 1] > 200) paperPx++
      }
      return inkPx > 16 && paperPx > 16
    }

    try {
      let ok = attempt()
      let tries = 1
      while (!ok && tries < 4) {
        gl.deleteProgram(this.pass!.program)
        this.compile()
        ok = attempt()
        tries++
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(fb)
      gl.deleteTexture(sampleTex)
      gl.deleteTexture(outTex)
      if (!ok) {
        throw new Error('macpaint gl self-test failed: no ink and no paper landed')
      }
    } catch (err) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(fb)
      gl.deleteTexture(sampleTex)
      gl.deleteTexture(outTex)
      throw err
    }
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
    this.pass = null
    this.srcTex = null
  }

  /** Run the print over the given 2D source; returns the GL canvas holding
   *  the finished frame (draw it onto the 2D context). Every parameter
   *  arrives already clamped to the shader's own published range. */
  render(p: MacpaintParams): HTMLCanvasElement {
    const gl = this.gl
    const w = p.source.width
    const h = p.source.height
    if (gl.isContextLost() || this.lost) throw new Error('gl lost')
    if (this.pass === null) throw new Error('macpaint gl disposed')
    if (this.srcW !== w || this.srcH !== h || this.srcTex === null) {
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
    this.canvas.width = w
    this.canvas.height = h

    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, p.source)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    const P = this.pass
    gl.useProgram(P.program)
    gl.bindVertexArray(this.quadVao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.uniform1i(P.uniforms.iChannel0, 0)
    gl.uniform2f(P.uniforms.iResolution, w, h)
    gl.uniform1i(P.uniforms.slots, p.slotsLo | 0)
    gl.uniform1i(P.uniforms.slots_hi, p.slotsHi | 0)
    gl.uniform1f(P.uniforms.bitmap_width, p.bitmapWidth)
    gl.uniform1f(P.uniforms.threshold, p.threshold)
    gl.uniform1f(P.uniforms.contrast, p.contrast)
    gl.uniform1f(P.uniforms.grain, p.grain)
    gl.uniform1f(P.uniforms.smoothing, p.smoothing)
    gl.uniform1f(P.uniforms.sharpen, p.sharpen)
    gl.uniform1f(P.uniforms.radius, p.radius)
    gl.uniform1i(P.uniforms.edge_mode, p.edgeMode | 0)
    gl.uniform1f(P.uniforms.edge_threshold, p.edgeThreshold)
    gl.uniform1f(P.uniforms.edge_width, p.edgeWidth)
    gl.uniform3f(P.uniforms.ink_color, p.ink[0], p.ink[1], p.ink[2])
    gl.uniform3f(P.uniforms.paper_color, p.paper[0], p.paper[1], p.paper[2])
    gl.uniform1f(P.uniforms.blend, p.blend)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('macpaint gl draw error')

    return this.canvas
  }
}

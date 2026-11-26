/**
 * Cubify filter — effect.app's Cubify effect, PORTED 1:1 FROM ITS SHADER.
 *
 * The real GLSL was captured from effect.app's live editor (hooking
 * WebGLRenderingContext.shaderSource while the Cubify effect compiled) and
 * every constant below is theirs, not an interpretation:
 *
 *   distort(pos, m):
 *     1. rotate the coordinates by `angle` degrees
 *     2. scale onto an exponentially-sized grid: scxy = exp(scale ± aspect)
 *        (the "cube size" dial is logarithmic — +1 unit ≈ 2.7× bigger cubes)
 *     3. add the position offset + animation drift in GRID units
 *     4. take the fractional position inside each cell and WARP it toward
 *        the cell's TILE SHAPE:
 *        - cube (the original): per-axis edge pull — smoothstep(0,1,f)
 *          `depth` whole times (fractional remainder blended), or the
 *          step(0.5,f) corner snap with "hard edges" on
 *        - circle / oval: the same pull applied RADIALLY — the sample
 *          slides along its ray from the cell center, inner half pulling
 *          to the bead's center, outer half to its rim (a glass bubble);
 *          the oval runs the identical math in a squashed frame (a 1.0×0.7
 *          ellipse) so it reads as an oval lens
 *        - diamond: the per-axis pull in a 45°-rotated, √2-scaled frame —
 *          the diamond's four points (the cell's edge midpoints) stay put
 *          and the cell's corners pull onto the diamond's edges
 *        - triangle: the pull across the cell's lower-left half, mirrored
 *          for the upper half — two folded prism faces per cell
 *     5. undo the transform and resample the frame (linear, clamped)
 *   run(): three warps with per-channel strengths (R and B get
 *     (1.2 ∓ dispersion)/1.2 of the depth) for chromatic edge fringing.
 *
 * SHAPE MIXES: the grid can carry more than one tile geometry at once.
 * Which shape a cell carries is a pure function of the cell's grid index:
 * one shape tiles everything; two alternate in a checkerboard
 * (mod(x+y, 2)); three or more shuffle cell by cell by a stable sin hash.
 * The assignment scrolls with the grid exactly like the cells themselves.
 * Shape mixes run ONE warp per pixel — all three channels sample through
 * the identical distort, because the captured shader's per-channel
 * dispersion would print three differently-warped ghost copies of every
 * non-cube tile (shapes stacked on top of each other) and smear gray
 * patch tiles wherever a cell straddles the frame's content edge; the
 * chromatic glass therefore stays a classic-cube feature. The round beads
 * are SCREEN-TRUE: the grid's cells are wider/taller than square by the
 * stretch dial (scy/scx = exp(∓2·stretch)), so the radial math grows off
 * the square cell frame and inscribes the cell's SMALLER screen dimension —
 * circles render as circles and ovals as 70%-height ovals whatever the
 * dials do. TILE GAPS: each mixed tile can cut a real silhouette — the
 * print fades to black across a rim band at the shape's boundary (and
 * everywhere outside it), so circles read as beads, diamonds as gems and
 * cubes as blocks; 0 keeps the seamless original glass. The factory
 * single-cube path is byte-identical to the captured shader.
 *
 * That is the whole effect — there is no bevel, light or grout in the
 * original; the 3D read comes entirely from the edge-pull warp. (The tile
 * gaps above are this port's one addition to the glass, and only for the
 * shape mixes — the factory cube keeps the pure original.) The port
 * runs the IDENTICAL math on the GPU: two tiny WebGL programs share one
 * offscreen GL canvas — the captured original (used whenever the mix is
 * exactly the factory cube: byte-identical output AND its original
 * instruction mix, which software-GL rasterizers measurably need) and the
 * tile-shape program (any other mix) — and the result is composited back
 * over the frame (one texture upload + one quad per frame). Where WebGL is
 * unavailable a per-pixel CPU fallback runs the same formulas with bilinear
 * sampling, so the look never silently disappears.
 *
 * Clock: the animation drift follows the decorative style clock (wall clock
 * live so the cubes keep drifting while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive previews.
 *
 * Beat pop (opt-in): on a detected low-end hit the depth distortion punches
 * deeper, driven by frame.bass through the shared additive `beatAmount`
 * gate — resting EXACTLY at the dialed look between kicks. Dispersion is
 * deliberately NOT beat-driven; it stays exactly where its dial sits.
 *
 * Deterministic: no Math.random, no time-hashed noise — the shape mix's
 * per-cell hash is a pure function of the cell index, so same frame in,
 * same pixels out, and the live preview and offline exports agree
 * frame-exactly. Skipped on transparent backgrounds like every full-frame
 * filter.
 */
import type { AudioFrame, CubifyFilterConfig, CubifyShape, RenderContext } from './types'
import { CUBIFY_SHAPE_ORDER } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'

/* ------------------------------- GLSL (WebGL1) ------------------------------ */
/* Transcribed from the captured effect.app Cubify fragment shader — same
 * constants (baseIOR 1.2), same rotation matrices, same warp loop. */

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/* The captured effect.app program — used whenever the tile mix is exactly
 * the factory cube. Byte-identical to the original shader and its original
 * instruction mix: under software GL (SwiftShader) even an unreached
 * dispatch branch in the program measurably slows the rasterizer, so the
 * classic look gets its own clean program. */
const FRAG_SRC_CLASSIC = `
precision highp float;
uniform sampler2D iChannel0;
uniform vec2 iResolution;
uniform float iTimelineTime;
uniform float uScale;
uniform float uAspect;
uniform float uDepth;
uniform float uHard;
uniform float uAngle;
uniform vec2 uPhase;
uniform vec2 uSpeed;
uniform float uDispersion;

vec2 toRel(vec2 fragPx) {
  float ar = iResolution.x / max(iResolution.y, 1e-6);
  vec2 inc = ar > 1.0 ? vec2(ar, 1.0) : vec2(1.0, 1.0 / ar);
  return (fragPx / iResolution * 2.0 - 1.0) * inc;
}

vec2 fromRel(vec2 rel) {
  float ar = iResolution.x / max(iResolution.y, 1e-6);
  vec2 inc = ar > 1.0 ? vec2(ar, 1.0) : vec2(1.0, 1.0 / ar);
  return (rel / inc + 1.0) / 2.0;
}

vec4 pixel(vec2 pos) {
  return texture2D(iChannel0, fromRel(pos));
}

vec2 distort(vec2 pos, float strengthVal) {
  float s = sin(radians(uAngle));
  float c = cos(radians(uAngle));
  pos *= mat2(c, s, -s, c);
  vec2 scxy = vec2(exp(uScale + uAspect), exp(uScale - uAspect));
  vec2 deltaPhase = uSpeed * iTimelineTime;
  pos = (pos * scxy) + (uPhase + deltaPhase);
  vec2 base = floor(pos);
  pos -= base;

  if (uHard > 0.5) {
    pos = step(0.5, pos);
  } else {
    // The original applies smoothstep(0,1,f) floor(m) whole times and mixes
    // the fractional remainder. GLSL ES 1.00 forbids data-dependent loops,
    // so the ≤5 iterations (the dial's max) unroll into chained mixes —
    // arithmetically identical: mix(a, b, clamp(k,0,1)) chains accumulate
    // exactly one smoothstep per whole unit of k.
    float k = clamp(strengthVal, 0.0, 5.0);
    vec2 s1v = smoothstep(0.0, 1.0, pos);
    vec2 s2v = smoothstep(0.0, 1.0, s1v);
    vec2 s3v = smoothstep(0.0, 1.0, s2v);
    vec2 s4v = smoothstep(0.0, 1.0, s3v);
    vec2 s5v = smoothstep(0.0, 1.0, s4v);
    vec2 wv = mix(pos, s1v, clamp(k, 0.0, 1.0));
    wv = mix(wv, s2v, clamp(k - 1.0, 0.0, 1.0));
    wv = mix(wv, s3v, clamp(k - 2.0, 0.0, 1.0));
    wv = mix(wv, s4v, clamp(k - 3.0, 0.0, 1.0));
    wv = mix(wv, s5v, clamp(k - 4.0, 0.0, 1.0));
    pos = wv;
  }

  pos = (pos + base - (uPhase + deltaPhase)) / scxy;
  pos *= mat2(c, -s, s, c);
  return pos;
}

void main() {
  const float baseIOR = 1.2;
  vec2 pos = toRel(gl_FragCoord.xy);

  float sG = uDepth * (baseIOR / baseIOR);
  float sR = uDepth * ((baseIOR - uDispersion) / baseIOR);
  float sB = uDepth * ((baseIOR + uDispersion) / baseIOR);

  float r = pixel(distort(pos, sR)).r;
  float g = pixel(distort(pos, sG)).g;
  float b = pixel(distort(pos, sB)).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
`

/* The tile-shape program — same pipeline, with the per-cell shape dispatch
 * (five tile geometries, checkerboard and hash mixes). Runs whenever the
 * mix is anything other than the single factory cube. ONE warp per pixel:
 * no per-channel dispersion (that glass belongs to the classic cube
 * program — on shapes it stacked three ghost copies per tile), plus the
 * tile-gap silhouette pass and screen-true bead geometry. */
const FRAG_SRC_SHAPES = `
precision highp float;
uniform sampler2D iChannel0;
uniform vec2 iResolution;
uniform float iTimelineTime;
uniform float uScale;
uniform float uAspect;
uniform float uDepth;
uniform float uHard;
uniform float uAngle;
uniform vec2 uPhase;
uniform vec2 uSpeed;
uniform vec4 uShapeA; // mixed tile shapes 1..4 (ids: 0 cube, 1 circle, 2 oval, 3 diamond, 4 triangle)
uniform float uShapeB; // mixed tile shape 5
uniform float uShapeN; // how many shapes mix (1..5)
uniform float uGaps;   // tile silhouette rim, 0..1 (0 = seamless glass)

vec2 toRel(vec2 fragPx) {
  float ar = iResolution.x / max(iResolution.y, 1e-6);
  vec2 inc = ar > 1.0 ? vec2(ar, 1.0) : vec2(1.0, 1.0 / ar);
  return (fragPx / iResolution * 2.0 - 1.0) * inc;
}

vec2 fromRel(vec2 rel) {
  float ar = iResolution.x / max(iResolution.y, 1e-6);
  vec2 inc = ar > 1.0 ? vec2(ar, 1.0) : vec2(1.0, 1.0 / ar);
  return (rel / inc + 1.0) / 2.0;
}

vec4 pixel(vec2 pos) {
  return texture2D(iChannel0, fromRel(pos));
}

/* The depth dial's iterated edge pull — smoothstep(0,1,x) applied k whole
 * times, the fractional remainder blended. GLSL ES 1.00 forbids
 * data-dependent loops, so the ≤5 iterations (the dial's max) unroll into
 * chained mixes — arithmetically identical: mix(a, b, clamp(k,0,1)) chains
 * accumulate exactly one smoothstep per whole unit of k. */
float pull(float x, float k) {
  float s1 = smoothstep(0.0, 1.0, x);
  float s2 = smoothstep(0.0, 1.0, s1);
  float s3 = smoothstep(0.0, 1.0, s2);
  float s4 = smoothstep(0.0, 1.0, s3);
  float s5 = smoothstep(0.0, 1.0, s4);
  float w = mix(x, s1, clamp(k, 0.0, 1.0));
  w = mix(w, s2, clamp(k - 1.0, 0.0, 1.0));
  w = mix(w, s3, clamp(k - 2.0, 0.0, 1.0));
  w = mix(w, s4, clamp(k - 3.0, 0.0, 1.0));
  w = mix(w, s5, clamp(k - 4.0, 0.0, 1.0));
  return w;
}

/* Stable per-cell hash (the classic sin trick) — deals the shapes across
 * the grid when three or more mix. Purely a function of the cell index, so
 * the mix scrolls with the grid and never flickers. */
float cellHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}

/* Which tile shape this cell carries: one shape everywhere, two in a
 * checkerboard (mod(x+y,2) — GLSL mod stays non-negative for negative
 * sums), three or more by the hash. */
float pickShape(vec2 cell) {
  if (uShapeN < 1.5) return uShapeA.x;
  if (uShapeN < 2.5) {
    return mod(cell.x + cell.y, 2.0) < 0.5 ? uShapeA.x : uShapeA.y;
  }
  float seg = floor(cellHash(cell) * uShapeN);
  float s = uShapeA.x;
  if (seg > 0.5) s = uShapeA.y;
  if (seg > 1.5) s = uShapeA.z;
  if (seg > 2.5) s = uShapeA.w;
  if (seg > 3.5) s = uShapeB;
  return s;
}

/* The grid cells are wider or taller than screen-square by the stretch dial
 * (cell width : height = scy : scx = exp(∓2·uAspect) — the rel coordinate
 * frame is screen-isotropic, so the exp ratio IS the screen aspect). These
 * grow factors push the radial bead math off the square cell frame so a
 * "circle" inscribes the cell's SMALLER screen dimension and renders round
 * whatever the stretch does; the oval then squashes to 70% of that circle's
 * height. */
vec2 beadGrow() {
  float ca = exp(-2.0 * uAspect);
  return vec2(max(1.0, ca), max(1.0, 1.0 / ca));
}

/* One cell's warp — f is the fractional position inside the cell ([0,1)²;
 * corner-adjacent samples push past 1 in the rotated frames and the
 * smoothstep chain clamps them, exactly like the original). Hard mode snaps
 * each shape to its landmarks instead of the smooth pull: the cube to its
 * four corners, the beads to center-or-rim, the diamond to its points, the
 * folded triangle to its corners. */
vec2 warpCell(vec2 f, float shape, float k) {
  if (shape < 0.5) {
    // CUBE — the captured effect.app per-axis edge pull, untouched
    if (uHard > 0.5) return step(0.5, f);
    return vec2(pull(f.x, k), pull(f.y, k));
  }
  if (shape < 2.5) {
    // CIRCLE / OVAL — the same pull applied radially in the cell: inner
    // half pulls toward the bead's center, outer half toward its rim. The
    // frame grows off the square cell (beadGrow) so the bead is screen-true
    // (a circle inscribed in the cell's smaller dimension); the oval is the
    // same bead squashed to a 0.7-height ellipse.
    vec2 grow = beadGrow();
    vec2 p = (f - 0.5) * 2.0 * grow;
    if (shape > 1.5) p.y /= 0.7;
    float r = max(length(p), 1e-4);
    float rn = uHard > 0.5 ? step(0.5, r) : pull(r, k);
    vec2 outc = p * (rn / r);
    vec2 inv = 1.0 / (2.0 * grow);
    return shape < 1.5
      ? vec2(0.5) + outc * inv
      : vec2(0.5) + vec2(outc.x * inv.x, outc.y * 0.7 * inv.y);
  }
  if (shape < 3.5) {
    // DIAMOND — the per-axis pull in a 45°-rotated, √2-scaled frame (the
    // pair collapses to plain (x−y, x+y) on the cell-centered coords, so
    // the +0.5 renormalizes (x−y) and (x+y−1) onto [0,1]): the diamond's
    // four points (the cell's edge midpoints) stay put and the cell's
    // corners pull onto the diamond's edges.
    vec2 g = vec2(f.x - f.y, f.x + f.y - 1.0) + 0.5;
    vec2 w = uHard > 0.5 ? step(0.5, g) : vec2(pull(g.x, k), pull(g.y, k));
    vec2 d = w - 0.5;
    return 0.5 + vec2(d.x + d.y, d.y - d.x) * 0.5;
  }
  // TRIANGLE — the pull across the cell's lower-left half, copied MIRRORED
  // into the upper half: two folded prism faces per cell. No unfold — the
  // per-axis pull is point-symmetric (S(1−t) = 1−S(t)), so folding and
  // unfolding again would collapse back to the exact cube warp; keeping the
  // folded sample is what makes the two faces (and the prism read) real.
  float fold = 1.0 - step(1.0, f.x + f.y);
  vec2 g = mix(1.0 - f, f, fold);
  return uHard > 0.5 ? step(0.5, g) : vec2(pull(g.x, k), pull(g.y, k));
}

/* The tile-gap silhouette — fades the print to black across a rim band at
 * each tile's boundary and everywhere outside it, so the mixed shapes read
 * as real mosaic tiles (0 = the seamless original glass, edge stays 1).
 * d is the pixel's shape distance: 0 at the cell's center, exactly 1 on the
 * tile's rim (the same frame each warp uses, so silhouette and lens agree).
 * The cube rims at its cell edges, the beads at their inscribed circle /
 * 0.7 oval, the diamond at its g-square rim, the triangle at its fold. */
float tileEdge(vec2 f, float shape) {
  if (uGaps <= 0.001) return 1.0;
  float d;
  if (shape < 0.5) {
    d = max(abs(f.x - 0.5), abs(f.y - 0.5)) * 2.0;
  } else if (shape < 2.5) {
    vec2 grow = beadGrow();
    vec2 p = (f - 0.5) * 2.0 * grow;
    if (shape > 1.5) p.y /= 0.7;
    d = length(p);
  } else if (shape < 3.5) {
    vec2 g = vec2(f.x - f.y, f.x + f.y - 1.0) + 0.5;
    d = max(abs(g.x - 0.5), abs(g.y - 0.5)) * 2.0;
  } else {
    d = f.x + f.y;
  }
  float w = mix(0.05, 0.3, uGaps);
  return 1.0 - smoothstep(1.0 - w, 1.0, d);
}

void main() {
  // ONE clean warp per pixel — the whole rotate → scale → phase → dispatch
  // pipeline inline, then a single sample and the silhouette multiply.
  vec2 pos = toRel(gl_FragCoord.xy);
  float s = sin(radians(uAngle));
  float c = cos(radians(uAngle));
  pos *= mat2(c, s, -s, c);
  vec2 scxy = vec2(exp(uScale + uAspect), exp(uScale - uAspect));
  vec2 deltaPhase = uSpeed * iTimelineTime;
  pos = (pos * scxy) + (uPhase + deltaPhase);
  vec2 base = floor(pos);
  vec2 f = pos - base;
  float shape = pickShape(base);
  vec2 uv = warpCell(f, shape, uDepth);
  uv = (uv + base - (uPhase + deltaPhase)) / scxy;
  uv *= mat2(c, -s, s, c);
  vec3 col = pixel(uv).rgb;
  col *= tileEdge(f, shape);
  gl_FragColor = vec4(col, 1.0);
}
`

/* ------------------------------ GL plumbing --------------------------------- */

interface GLProgram {
  program: WebGLProgram
  loc: Record<string, WebGLUniformLocation | null>
}

interface CubifyGL {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  /** The captured effect.app program — used whenever the tile mix is
   *  exactly the factory cube (byte-identical output, original speed). */
  classic: GLProgram
  /** The tile-shape program for any other mix — null when its build failed
   *  (those looks then run on the CPU path). */
  shapes: GLProgram | null
  tex: WebGLTexture
  w: number
  h: number
}

const CLASSIC_UNIFORMS = [
  'iResolution',
  'iTimelineTime',
  'uScale',
  'uAspect',
  'uDepth',
  'uHard',
  'uAngle',
  'uPhase',
  'uSpeed',
  'uDispersion',
  'iChannel0',
]

const SHAPE_UNIFORMS = [...CLASSIC_UNIFORMS, 'uShapeA', 'uShapeB', 'uShapeN', 'uGaps']

/** One GL context is enough: the preview and the offline export never
 *  interleave frames, so the bundle resizes to whoever renders next. */
let cubifyGL: CubifyGL | null = null

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

/** Compile + link one program and collect its uniform locations. Both
 *  programs pin aPos to attribute slot 0 so they share the one quad buffer. */
function buildProgram(gl: WebGLRenderingContext, fragSrc: string, uniforms: readonly string[]): GLProgram | null {
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
    const program = gl.createProgram()
    if (!vs || !fs || !program) return null
    gl.bindAttribLocation(program, 0, 'aPos')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    const loc: Record<string, WebGLUniformLocation | null> = {}
    for (const name of uniforms) loc[name] = gl.getUniformLocation(program, name)
    return { program, loc }
  } catch {
    return null
  }
}

/** Build (or rebuild) the offscreen GL bundle. Returns null when WebGL is
 *  unavailable — the caller falls back to the CPU path. */
function getGL(w: number, h: number): CubifyGL | null {
  if (cubifyGL) return cubifyGL
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const gl = (canvas.getContext('webgl', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return null

    const classic = buildProgram(gl, FRAG_SRC_CLASSIC, CLASSIC_UNIFORMS)
    if (!classic) return null
    const shapes = buildProgram(gl, FRAG_SRC_SHAPES, SHAPE_UNIFORMS)

    // Fullscreen quad: one strip covering [-1,1]², shared by both programs.
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    // Source texture: LINEAR + CLAMP_TO_EDGE (the only legal combo for
    // NPOT in WebGL1 — and exactly how the original resamples).
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // Row 0 of the 2D canvas (its top) must land at v=1 so the y-up GL
    // coordinates match the original's gl_FragCoord convention.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))

    cubifyGL = {
      canvas,
      gl,
      classic,
      shapes,
      tex,
      w: 0,
      h: 0,
    }
    return cubifyGL
  } catch {
    return null
  }
}

function drawGL(g: CubifyGL, rc: RenderContext, p: CubifyParams): void {
  const { gl } = g
  const bundle = p.cubeOnly ? g.classic : g.shapes
  if (!bundle) return
  const { loc } = bundle
  const { width: W, height: H, ctx } = rc
  if (g.w !== W || g.h !== H) {
    g.canvas.width = W
    g.canvas.height = H
    g.w = W
    g.h = H
  }
  gl.viewport(0, 0, W, H)
  gl.useProgram(bundle.program)

  // The finished frame IS the source texture (the filter sits at the end of
  // the chain, exactly like the original's global-input iChannel0).
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, g.tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas)

  gl.uniform2f(loc.iResolution!, W, H)
  gl.uniform1f(loc.iTimelineTime!, p.time)
  gl.uniform1f(loc.uScale!, p.scale)
  gl.uniform1f(loc.uAspect!, p.stretch)
  gl.uniform1f(loc.uDepth!, p.depth)
  gl.uniform1f(loc.uHard!, p.hard ? 1 : 0)
  gl.uniform1f(loc.uAngle!, p.angle)
  gl.uniform2f(loc.uPhase!, p.offsetX, p.offsetY)
  gl.uniform2f(loc.uSpeed!, p.speedX, p.speedY)
  gl.uniform1f(loc.uDispersion!, p.dispersion)
  if (!p.cubeOnly) {
    gl.uniform4f(
      loc.uShapeA!,
      p.shapeIds[0] ?? 0,
      p.shapeIds[1] ?? 0,
      p.shapeIds[2] ?? 0,
      p.shapeIds[3] ?? 0,
    )
    gl.uniform1f(loc.uShapeB!, p.shapeIds[4] ?? 0)
    gl.uniform1f(loc.uShapeN!, p.shapeN)
    gl.uniform1f(loc.uGaps!, p.gaps)
  }
  if (loc.iChannel0) gl.uniform1i(loc.iChannel0, 0)

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/* ------------------------------- warp math (CPU fallback) ------------------- */

function smoothstep01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

/** The depth dial's iterated edge pull — the exact JS mirror of the
 *  shader's pull(): smoothstep applied k whole times, the fractional
 *  remainder blended (the old while-loop form, unrolled identically). */
function pull(x: number, k: number): number {
  const s1 = smoothstep01(x)
  const s2 = smoothstep01(s1)
  const s3 = smoothstep01(s2)
  const s4 = smoothstep01(s3)
  const s5 = smoothstep01(s4)
  let w = x + (s1 - x) * Math.min(Math.max(k, 0), 1)
  w = w + (s2 - w) * Math.min(Math.max(k - 1, 0), 1)
  w = w + (s3 - w) * Math.min(Math.max(k - 2, 0), 1)
  w = w + (s4 - w) * Math.min(Math.max(k - 3, 0), 1)
  w = w + (s5 - w) * Math.min(Math.max(k - 4, 0), 1)
  return w
}

/** Stable per-cell hash — the same classic sin trick the shader uses. GPU
 *  and JS sin may disagree in the low bits, which can only ever re-deal
 *  WHICH shape a cell carries in the 3+ mix (the CPU fallback is an
 *  availability path, not a byte-exact one); the deal is deterministic
 *  within each. */
function cellHash(bx: number, by: number): number {
  const v = Math.sin(bx * 127.1 + by * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** Which tile shape the cell at grid index (bx,by) carries — the JS mirror
 *  of the shader's pickShape: 1 everywhere, 2 checkerboard, 3+ hashed. */
function pickShape(bx: number, by: number, shapes: number[]): number {
  const n = shapes.length
  if (n < 2) return shapes[0] ?? 0
  if (n === 2) {
    const chk = (((bx + by) % 2) + 2) % 2
    return chk === 0 ? (shapes[0] ?? 0) : (shapes[1] ?? 0)
  }
  const seg = Math.min(Math.floor(cellHash(bx, by) * n), n - 1)
  return shapes[seg] ?? 0
}

/** The grid cells' screen-aspect grow factors — the JS mirror of the
 *  shader's beadGrow(): the stretch dial makes cells wider/taller than
 *  screen-square (scy/scx = exp(∓2·stretch), and the rel frame is
 *  screen-isotropic), so the beads grow off the square cell frame and
 *  inscribe the cell's SMALLER screen dimension. */
function beadGrow(stretch: number): [number, number] {
  const ca = Math.exp(-2 * stretch)
  return [Math.max(1, ca), Math.max(1, 1 / ca)]
}

/** One cell's warp — the JS mirror of the shader's warpCell: same five
 *  shapes, same hard-landmark snaps, same border-fixing pulls, same
 *  screen-true bead frame (grow) and 0.7-height oval. */
function warpCell(
  fx: number,
  fy: number,
  shape: number,
  k: number,
  hard: boolean,
  gx: number,
  gy: number,
): [number, number] {
  if (shape < 0.5) {
    // CUBE — the original per-axis edge pull
    if (hard) return [fx >= 0.5 ? 1 : 0, fy >= 0.5 ? 1 : 0]
    return [pull(fx, k), pull(fy, k)]
  }
  if (shape < 2.5) {
    // CIRCLE / OVAL — the radial bead pull in the screen-true frame (the
    // oval squashes to 0.7 of the inscribed circle's height)
    const circle = shape < 1.5
    const px = (fx - 0.5) * 2.0 * gx
    const py = (fy - 0.5) * 2.0 * gy * (circle ? 1 : 1 / 0.7)
    const r = Math.max(Math.hypot(px, py), 1e-4)
    const rn = hard ? (r >= 0.5 ? 1 : 0) : pull(r, k)
    const ox = px * (rn / r)
    const oy = py * (rn / r)
    return circle
      ? [0.5 + ox / (2 * gx), 0.5 + oy / (2 * gy)]
      : [0.5 + ox / (2 * gx), 0.5 + (oy * 0.7) / (2 * gy)]
  }
  if (shape < 3.5) {
    // DIAMOND — the pull in the (x−y, x+y−1) frame
    const dgx = fx - fy + 0.5
    const dgy = fx + fy - 0.5
    const wx = hard ? (dgx >= 0.5 ? 1 : 0) : pull(dgx, k)
    const wy = hard ? (dgy >= 0.5 ? 1 : 0) : pull(dgy, k)
    const dx = wx - 0.5
    const dy = wy - 0.5
    return [0.5 + (dx + dy) * 0.5, 0.5 + (dy - dx) * 0.5]
  }
  // TRIANGLE — the folded half-cell pull, mirrored (no unfold: the per-axis
  // pull is point-symmetric, so unfolding would collapse back to the cube)
  const fold = fx + fy < 1
  const tgx = fold ? fx : 1 - fx
  const tgy = fold ? fy : 1 - fy
  if (hard) return [tgx >= 0.5 ? 1 : 0, tgy >= 0.5 ? 1 : 0]
  return [pull(tgx, k), pull(tgy, k)]
}

/** The tile-gap silhouette — the JS mirror of the shader's tileEdge(): 1
 *  inside the tile, fading to 0 across the rim band at the shape's boundary
 *  and everywhere outside it (0 gaps = the seamless glass, always 1). */
function tileEdge(
  fx: number,
  fy: number,
  shape: number,
  gaps: number,
  gx: number,
  gy: number,
): number {
  if (gaps <= 0.001) return 1
  let d: number
  if (shape < 0.5) {
    d = Math.max(Math.abs(fx - 0.5), Math.abs(fy - 0.5)) * 2
  } else if (shape < 2.5) {
    const px = (fx - 0.5) * 2 * gx
    const py = (fy - 0.5) * 2 * gy * (shape < 1.5 ? 1 : 1 / 0.7)
    d = Math.hypot(px, py)
  } else if (shape < 3.5) {
    const dgx = fx - fy + 0.5
    const dgy = fx + fy - 0.5
    d = Math.max(Math.abs(dgx - 0.5), Math.abs(dgy - 0.5)) * 2
  } else {
    d = fx + fy
  }
  const w = 0.05 + 0.25 * gaps
  const t = Math.min(Math.max((d - (1 - w)) / w, 0), 1)
  return 1 - t * t * (3 - 2 * t)
}

/** The captured distort() — identical transforms, same order; the warp
 *  step dispatches through warpCell so every tile shape rides the same
 *  rotate → scale → phase → warp → undo pipeline the cube always did.
 *  Also returns the pixel's tile-gap edge factor (the pixel's own cell and
 *  shape are identical across the dispersion's three warps — same grid,
 *  same base, only the pull strength differs — so one factor serves all). */
function distortX(
  x: number,
  y: number,
  m: number,
  cosA: number,
  sinA: number,
  scx: number,
  scy: number,
  phaseX: number,
  phaseY: number,
  hard: boolean,
  shapes: number[],
  gaps: number,
  gx: number,
  gy: number,
): [number, number, number] {
  // rotate by +angle (mat2(c,s,-s,c) in GLSL column-major)
  let px = cosA * x - sinA * y
  let py = sinA * x + cosA * y
  px = px * scx + phaseX
  py = py * scy + phaseY
  const bx = Math.floor(px)
  const by = Math.floor(py)
  const fx = px - bx
  const fy = py - by
  const shape = pickShape(bx, by, shapes)
  const warped = warpCell(fx, fy, shape, m, hard, gx, gy)
  px = (warped[0] + bx - phaseX) / scx
  py = (warped[1] + by - phaseY) / scy
  const edge = tileEdge(fx, fy, shape, gaps, gx, gy)
  // rotate back (mat2(c,-s,s,c))
  return [cosA * px + sinA * py, -sinA * px + cosA * py, edge]
}

interface CubifyParams {
  time: number
  scale: number
  stretch: number
  depth: number
  hard: boolean
  angle: number
  offsetX: number
  offsetY: number
  speedX: number
  speedY: number
  dispersion: number
  /** Tile-gap silhouette strength 0..1 — already gated to 0 for the
   *  factory single-cube look (which never cuts silhouettes). */
  gaps: number
  /** Tile shape ids in mix order (0 cube, 1 circle, 2 oval, 3 diamond,
   *  4 triangle) — 1..5 entries, normalized to canonical order. */
  shapeIds: number[]
  /** How many shapes mix (shapeIds.length, 1..5). */
  shapeN: number
  /** True when the mix is exactly the factory cube — picks the classic
   *  program (the captured shader verbatim) over the shape-dispatch one. */
  cubeOnly: boolean
}

/** Per-pixel port of the shader for environments without WebGL: same math,
 *  bilinear clamped sampling, ~one to three samples per pixel. */
function drawCPU(rc: RenderContext, p: CubifyParams, blend: number): void {
  const { ctx, width: W, height: H } = rc
  const src = getWork('cubify:src', W, H)
  const sctx = resetWork(src.getContext('2d', { willReadFrequently: true })!)
  sctx.drawImage(ctx.canvas, 0, 0)
  const data = sctx.getImageData(0, 0, W, H).data
  const out = getWork('cubify:out', W, H)
  const octx = resetWork(out.getContext('2d', { willReadFrequently: true })!)
  const img = octx.createImageData(W, H)
  const d8 = img.data

  const ar = W / Math.max(H, 1e-6)
  const incX = ar > 1 ? ar : 1
  const incY = ar > 1 ? 1 : 1 / ar
  const rad = (p.angle * Math.PI) / 180
  const cosA = Math.cos(rad)
  const sinA = Math.sin(rad)
  const scx = Math.exp(p.scale + p.stretch)
  const scy = Math.exp(p.scale - p.stretch)
  const phaseX = p.offsetX + p.speedX * p.time
  const phaseY = p.offsetY + p.speedY * p.time
  const ior = 1.2
  const mG = p.depth
  const mR = (p.depth * (ior - p.dispersion)) / ior
  const mB = (p.depth * (ior + p.dispersion)) / ior
  // One clean warp for shape mixes — the per-channel split would print
  // three differently-warped ghost copies of every non-cube tile (stacked
  // shapes). The chromatic glass stays a classic-cube feature.
  const split = p.dispersion > 0.0005 && p.cubeOnly
  const [gx, gy] = beadGrow(p.stretch)

  const sample = (u: number, v: number): [number, number, number] => {
    // uv 0..1 y-up (GL convention) → ImageData row 0 is the TOP row
    const fx = Math.min(Math.max(u, 0), 1) * W - 0.5
    const fy = (1 - Math.min(Math.max(v, 0), 1)) * H - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    let acc = [0, 0, 0]
    for (let sy = 0; sy < 2; sy++) {
      const yy = Math.min(Math.max(y0 + sy, 0), H - 1)
      const wy = sy === 0 ? 1 - ty : ty
      for (let sx = 0; sx < 2; sx++) {
        const xx = Math.min(Math.max(x0 + sx, 0), W - 1)
        const w = wy * (sx === 0 ? 1 - tx : tx)
        const kk = (yy * W + xx) * 4
        acc[0] += data[kk] * w
        acc[1] += data[kk + 1] * w
        acc[2] += data[kk + 2] * w
      }
    }
    return acc as [number, number, number]
  }

  for (let py = 0; py < H; py++) {
    // gl_FragCoord.y is y-up from the bottom
    const fragY = H - 0.5 - py
    for (let px = 0; px < W; px++) {
      const fragX = px + 0.5
      const relX = ((fragX / W) * 2 - 1) * incX
      const relY = ((fragY / H) * 2 - 1) * incY
      let r: number
      let g: number
      let b: number
      if (split) {
        const uvR = distortX(relX, relY, mR, cosA, sinA, scx, scy, phaseX, phaseY, p.hard, p.shapeIds, p.gaps, gx, gy)
        const uvG = distortX(relX, relY, mG, cosA, sinA, scx, scy, phaseX, phaseY, p.hard, p.shapeIds, p.gaps, gx, gy)
        const uvB = distortX(relX, relY, mB, cosA, sinA, scx, scy, phaseX, phaseY, p.hard, p.shapeIds, p.gaps, gx, gy)
        const cR = sample((uvR[0] / incX + 1) / 2, (uvR[1] / incY + 1) / 2)
        const cG = sample((uvG[0] / incX + 1) / 2, (uvG[1] / incY + 1) / 2)
        const cB = sample((uvB[0] / incX + 1) / 2, (uvB[1] / incY + 1) / 2)
        r = cR[0] * uvG[2]
        g = cG[1] * uvG[2]
        b = cB[2] * uvG[2]
      } else {
        const uv = distortX(relX, relY, mG, cosA, sinA, scx, scy, phaseX, phaseY, p.hard, p.shapeIds, p.gaps, gx, gy)
        const c = sample((uv[0] / incX + 1) / 2, (uv[1] / incY + 1) / 2)
        r = c[0] * uv[2]
        g = c[1] * uv[2]
        b = c[2] * uv[2]
      }
      const o = (py * W + px) * 4
      d8[o] = r
      d8[o + 1] = g
      d8[o + 2] = b
      d8[o + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(out, 0, 0, W, H)
  if (blend < 0.999) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(src, 0, 0, W, H)
  }
  ctx.restore()
}

/* --------------------------------- the filter -------------------------------- */

/** Shape name → shader id (the order the GLSL checks in warpCell). */
const SHAPE_IDS: Record<CubifyShape, number> = { cube: 0, circle: 1, oval: 2, diamond: 3, triangle: 4 }

/** Normalize whatever arrived in cfg.shapes (old saves predate the field,
 *  share links may carry junk) into canonical-order shader ids, falling
 *  back to the original cube. */
function normalizeShapeIds(shapes: unknown): number[] {
  const present = new Set<string>(
    Array.isArray(shapes) ? shapes.filter((s): s is string => typeof s === 'string') : [],
  )
  const ids = CUBIFY_SHAPE_ORDER.filter((s) => present.has(s)).map((s) => SHAPE_IDS[s])
  return ids.length ? ids : [SHAPE_IDS.cube]
}

export function drawCubifyFilter(
  rc: RenderContext,
  cfg: CubifyFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const blend = clamp01(cfg.blend ?? 1)
  if (blend <= 0.001) return

  // Beat pop — additive on kicks, resting at exactly 0 between them: ONLY
  // the depth distortion punches deeper. Dispersion deliberately does not
  // react to the beat — it stays exactly where its dial sits.
  const beat = beatAmount(cfg, frame.bass)
  const depthEff = (cfg.depth ?? 1.8) + beat * 1.5

  const shapeIds = normalizeShapeIds(cfg.shapes)
  const cubeOnly = shapeIds.length === 1 && shapeIds[0] === 0
  const params: CubifyParams = {
    time: frame.styleTime,
    scale: cfg.scale ?? 0.6,
    stretch: cfg.stretch ?? -0.21,
    depth: depthEff,
    hard: !!cfg.hard,
    angle: cfg.angle ?? 35,
    offsetX: cfg.offsetX ?? 0,
    offsetY: cfg.offsetY ?? 0,
    speedX: cfg.speedX ?? -0.34,
    speedY: cfg.speedY ?? 0.34,
    dispersion: clamp01(cfg.dispersion ?? 0.75),
    // Tile gaps only cut silhouettes for shape mixes — the factory
    // single-cube look stays byte-identical whatever the dial sits at.
    gaps: cubeOnly ? 0 : clamp01(cfg.gaps ?? 0.5),
    shapeIds,
    shapeN: shapeIds.length,
    cubeOnly,
  }

  const g = getGL(W, H)
  if (!g || (!params.cubeOnly && !g.shapes)) {
    drawCPU(rc, params, blend)
    return
  }

  let base: HTMLCanvasElement | null = null
  if (blend < 0.999) {
    base = getWork('cubify:base', W, H)
    const bctx = resetWork(base.getContext('2d')!)
    bctx.drawImage(ctx.canvas, 0, 0)
  }

  drawGL(g, rc, params)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(g.canvas, 0, 0, W, H)
  if (base) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(base, 0, 0, W, H)
  }
  ctx.restore()
}

/**
 * Pulse Studio — shared type contracts.
 * Single source of truth for the render engine (2-a), UI panels (2-b),
 * and export pipeline (3). DO NOT break these interfaces.
 */

/* ---------------------------------- Gradient --------------------------------- */

export interface ColorStop {
  /** CSS color string, e.g. "#22c55e" or "#22c55ecc" */
  color: string
  /** Position along the gradient, 0..100 */
  position: number
  /** Opacity 0..100 (UI shows numeric value next to slider) */
  opacity: number
}

export interface GradientConfig {
  stops: ColorStop[]
  /** Gradient angle in degrees (0-360) — linear shape only */
  angle: number
  /** Gradient geometry: linear sweep at `angle`, or radial from the center outward */
  shape: GradientShape
  /** When true, the palette sweeps smoothly back and forth (colors stay in the palette) */
  cycleColors: boolean
  /** Sweep speed — one full back-and-forth pass per 1/speed seconds */
  cycleSpeed: number
}

export type GradientShape = 'linear' | 'radial'

export type GradientPresetId = 'sunset' | 'aurora' | 'ember' | 'neon' | 'mono'

/* --------------------------------- Visualizer -------------------------------- */

export type VisualizerStyle = 'bars' | 'wave' | 'radial' | 'particles' | 'blob' | 'grid' | 'ribbon' | 'perspective' | 'terrain' | 'sphere' | 'dotsphere' | 'serato' | 'imgviz'
export type MirrorMode = 'none' | 'mirror' | 'center'

export interface VisualizerConfig {
  style: VisualizerStyle
  /** Number of frequency bars / points (16..256) */
  barCount: number
  /** Analysis smoothing 0..1 (higher = calmer motion) */
  smoothing: number
  /** Overall reactivity multiplier 0.1..3 */
  sensitivity: number
  /** Bar corner radius / roundness 0..1 */
  roundness: number
  /** Gap between bars, 0..1 (fraction of slot width) */
  gap: number
  mirror: MirrorMode
  /** Vertical anchor of the mirror/center axis. Center: the figure's
   *  fold line moves with the dial (0 = top edge · 0.5 = middle (default) ·
   *  1 = bottom edge). Mirror on bars/grid: the dial slides the reflected
   *  copy in ONE direction — 0 hangs it from the ceiling (the classic
   *  full-height flip), 1 lowers it toward the bars (the lowest fully
   *  in-frame position); monotonic, no fold-back at the midpoint, and it
   *  stays fully in frame at every dial position and level — it can never
   *  leave the canvas. Mirror on wave:
   *  0.5 reproduces the classic symmetric fold; away from 0.5 the mirrored
   *  line slides up/down away from the pinned original, opening a real
   *  offset between the two (±0.28H of travel, fully in frame at the
   *  default amplitude). */
  mirrorOffset: number
  /** Draw gradient behind bars as filled background glow */
  glow: boolean
  gradient: GradientConfig
  /** Layer placement — horizontal center of the visualizer, 0..100% of canvas width (50 = centered) */
  positionX: number
  /** Layer placement — vertical center of the visualizer, 0..100% of canvas height (50 = centered) */
  positionY: number
  /** Layer zoom, 1 = natural size (0.1..2.5) — resize the whole visualizer in place */
  scale: number
  /** Layer order vs. the vinyl & cover: 'front' = bars on top (classic look),
   *  'back' = bars tucked behind the vinyl/cover so the record overlaps them */
  layer: 'front' | 'back'
  /** Strip direction for the horizontal styles (bars / wave / grid):
   *  'horizontal' = the classic left→right strip · 'vertical' = the same strip
   *  rotated 90° into a full-height column (bass stays at the bottom, bars
   *  grow sideways). Radial / particles / blob ignore it. */
  orientation: 'horizontal' | 'vertical'
  /** Which edge the vertical strip hangs from: 'right' = bars grow leftward
   *  from the right edge (classic, default) · 'left' = mirrored, bars grow
   *  rightward from the left edge. Only used when orientation = 'vertical'. */
  anchor: 'left' | 'right'
  /** Layer transparency 0..1 — the Style tab's Transparency dial. 0 (the
   *  factory value) is the classic fully-solid look, 1 fades the ENTIRE
   *  visualizer layer (bars, wave, glow backdrop, every pass) into whatever
   *  sits behind it. Scales uniformly on top of every inner alpha, exactly
   *  like the lyrics layer's opacity dial does for the words. */
  transparency: number
  /** Perspective road flow speed 0..1 — how fast the 3D equalizer's bars
   *  stream past the camera (0 = the road stands still, 1 = rush). The
   *  terrain landscape reads it too (its hills roll toward the camera);
   *  every other style ignores it. */
  flowSpeed: number
  /** Perspective style — the up-side (above the horizon line) bar color.
   *  The reference look is a hot red. Flat hex/8-digit color, not the
   *  palette: this style keeps a strict two-color split at every depth
   *  instead of sweeping the gradient. */
  perspUp: string
  /** Perspective style — the down-side (below the horizon) bar color.
   *  Reference look: electric blue. */
  perspDown: string
  /** Perspective style — LED segment texture 0..1. Fine vertical ribs inside
   *  the solid pills (and it gates how crisp the echo combs read). 0 = flat
   *  solid capsules. */
  perspTexture: number
  /** Perspective style — echo trails 0..1. A dimmer ribbed/dotted ghost
   *  extends past each pill's cap, filling where the bar stood a moment
   *  ago (up side gets rib combs, down side a dot matrix, like the
   *  reference). 0 = clean pills with no history. */
  perspEcho: number
  /** Perspective style — reflection offset 0..1. With Mirror on, the up
   *  bars reflect across a water line that normally hugs the road's horizon
   *  (the red reflection hides under the down bars). This dial slides the
   *  water line LOWER — the red reflection is the bars' exact 1:1 flip
   *  across that line, so it slides out from under the road like a
   *  wet-street mirror, keeping the bars' true height.
   *  0 = the classic hugging reflection (the factory look). */
  perspMirrorDrop: number
  /** Terrain style — solid-earth band fill 0..1. Each depth row fills the
   *  band between its ridge line and the flat ground below it (drawn far →
   *  near, so nearer bands overlap farther ones like real hills). 0 = the
   *  pure glowing wireframe. */
  terrainFill: number
  /** Terrain style — mirror dial, signed -1..1 (0 = the factory look in
   *  every mode). Mirror mode: slides ONLY the lake's water line — the
   *  range stays planted at its full perspective height (the near rows run
   *  past the bottom edge, deeper Horizon settings stretch it longer), the
   *  land is clipped at the line (below it there is only the reflection)
   *  and the reflection is the exact 1:1 flip of everything dry. 0 puts
   *  the line 72% down the canvas (the factory lake); positive sinks it
   *  toward the bottom edge (the lake shrinks toward a sliver; the
   *  flipped peaks may run past the frame like a real lake bigger than
   *  it, and the drowned foreground resurfaces), negative raises it into
   *  the range — high water: the flooded foothills vanish under the
   *  surface and the lake reflects the peaks still above the line, the
   *  travel spanning the dry land's full height so something dry always
   *  remains to reflect. Center mode: Spread — how deep the range's own
   *  underside grows (negative shallower, positive deeper). */
  terrainMirrorDrop: number
  /** Sphere style — spin speed 0..1. How fast the dot-matrix planet turns
   *  around its tilted axis (0 = a slow drift, 1 = a fast whirl). */
  sphereSpin: number
  /** Sphere style — audio quills 0..1. Every dot grows a spike outward with
   *  its own frequency band's energy (the bass equator surges, the treble
   *  poles crackle). 0 = the smooth pulsing shell, dots glued to the surface. */
  sphereQuills: number
  /** Dot Sphere style — ball radius as a multiple of the half-short side
   *  (0.75 = the whole ball visible in the center like the reference;
   *  above ~0.94 the poles crop past the frame edges) */
  dotSphereSize: number
  /** Dot Sphere style — the latitude circles of the dot grid (12..80) */
  dotSphereRows: number
  /** Dot Sphere style — the dot radius multiplier (0.4..2.2) */
  dotSphereDotSize: number
  /** Dot Sphere style — flow speed in radians/second: the spin that carries
   *  the dots horizontally around the ball (negative reverses the direction) */
  dotSphereFlow: number
  /** Dot Sphere style — wave amount 0..1: how far the rows swing vertically
   *  (the wavy band displacement, in row spacings) */
  dotSphereWave: number
  /** Dot Sphere style — WHOLE wave cycles around the ball's longitude (1..10,
   *  the dial steps integers). Must be an integer: a wave that doesn't close
   *  on itself tears at the longitude origin and the tear sweeps around the
   *  ball as it rotates (the visible seam). The renderer rounds anyway, so
   *  older fractional values heal too. */
  dotSphereWaveScale: number
  /** Dot Sphere style — wave speed: how fast the wave field travels
   *  (rad/s of phase) */
  dotSphereWaveSpeed: number
  /** Dot Sphere style — band twist 0..3: wave phase shift from row to row
   *  (the woven diagonal drift of the bands) */
  dotSphereTwist: number
  /** Dot Sphere style — music ripple 0..1: how hard each latitude row
   *  rides its own spectrum band — the band's energy pushes the surface
   *  outward along the ball's radius in traveling bulges (the surface
   *  ripples like a waveform, bottom rows = low end), deepens the row's
   *  own wave-band swing, and breathes the whole ball with the bass —
   *  all scaled by the shared Sensitivity dial. 0 = the smooth dialed
   *  sphere, silent in music. */
  dotSphereRipple: number
  /** Dot Sphere style — the soft halo radiating around every dot, 0..1 */
  dotSphereGlow: number
  /** Dot Sphere style — dot colors: 'neon' = the fixed pink/blue LED
   *  palette (the reference look), 'palette' = the user's own gradient
   *  palette swept across the dot hues, 'picture' = sampled from the
   *  picture behind the ball */
  dotSphereColors: 'neon' | 'picture' | 'palette'
  /** Dot Sphere style — the ball's solid face the dots sit on:
   *  'dark' = the near-black LED space (rests on transparent backgrounds),
   *  'color' = any picked color, 'image' = the user's picture cover-fitted
   *  inside the circular face (rounded like the orb, never stretched).
   *  The solid faces are painted as a lit 3D ball (upper-left light,
   *  specular glint, form shadow around the limb) instead of a flat disk;
   *  the picture face stays untouched. */
  dotSphereFace: 'dark' | 'color' | 'image'
  /** Dot Sphere style — the face color when dotSphereFace is 'color'
   *  (also the fallback under a face image that is still decoding) */
  dotSphereFaceColor: string
  /** Dot Sphere style — the face image (data URL) when dotSphereFace is
   *  'image'; rendered clipped to the orb's circle */
  dotSphereFaceSrc: string
  /** Dot Sphere style — react to beat: the wave swells and the dots flare
   *  on the song's low end (driven by frame.bass, additive, resting exactly
   *  at the dialed look between kicks) */
  dotSphereBeat: boolean
  /** Dot Sphere style — how hard the beat swell hits, 0..1 (only matters
   *  when dotSphereBeat is on) */
  dotSphereBeatStrength: number
  /** Serato style — seconds of the track visible across the strip (4..30).
   *  The turntable needle sits dead center and the whole-song waveform
   *  scrolls under it; this dial zooms the strip in and out. */
  seratoWindow: number
  /** Serato style — strip height as a fraction of the canvas, 0.3..1. */
  seratoHeight: number
  /** Serato style — column coloring: 'rainbow' = Serato's spectral map
   *  (bassy passages green, crisp ones pink), 'palette' = the gradient
   *  sweeping across the strip, 'solid' = the palette's first stop. */
  seratoColors: 'rainbow' | 'palette' | 'solid'
  /** Image style — the uploaded artwork (data URL) the whole style renders
   *  around. Transparency strongly recommended. */
  imgvizSrc: string
  /** Image style — rest size as % of canvas height (15..100) */
  imgvizSize: number
  /** Image style — dim the artwork 0..1 so the inner visualizer reads
   *  (0 = the artwork shows at full brightness, 1 = silhouette only) */
  imgvizDim: number
  /** Image style — which visualizer renders inside the silhouette (the
   *  real style renderers, clipped to the artwork's alpha shape) */
  imgvizInner: 'bars' | 'wave' | 'radial' | 'particles' | 'blob' | 'grid' | 'ribbon'
  /** Image style — inner visualizer amplitude gain 0.2..2 */
  imgvizInnerGain: number
  /** Image style — inner visualizer X anchor across the artwork's box
   *  (0..100, 50 = centered). Same anchor math as the main layer's
   *  Position X: the inner renderer's center is re-anchored at this
   *  fraction of the artwork's width. */
  imgvizInnerX: number
  /** Image style — inner visualizer Y anchor down the artwork's box
   *  (0..100, 50 = centered). Same anchor math as the main layer's
   *  Position Y. */
  imgvizInnerY: number
  /** Image style — inner visualizer orientation for the strip styles
   *  (bars / wave / grid / ribbon): horizontal = the classic left→right
   *  strip, vertical = rotated 90° counter-clockwise into a top→bottom
   *  column growing sideways from the box's right edge (bass at the
   *  bottom). The round styles (radial / dots / blob) ignore it. */
  imgvizInnerOrient: 'horizontal' | 'vertical'
  /** Image style — music motion on/off (swell, bob, sway and tilt driven
   *  by the bass/energy drive). Off pins the artwork still. */
  imgvizMotion: boolean
  /** Image style — how far the motion travels 0..1 (0 barely moves,
   *  1 full swell + drift) */
  imgvizMotionAmount: number
  /** Image style — glowing edges on/off (a contour band on the artwork's
   *  alpha edge, tinted and bloomed per frame, breathing with the drive) */
  imgvizGlow: boolean
  /** Image style — glow color: the visualizer palette or its own */
  imgvizGlowMode: 'palette' | 'custom'
  /** Image style — glow color when imgvizGlowMode = 'custom' */
  imgvizGlowColor: string
  /** Image style — glow strength 0..1 (drives both bloom draw alphas; the
   *  masks themselves bake dense so even mid strengths radiate) */
  imgvizGlowStrength: number
  /** Image style — where the edge glow paints: 'over' = the classic halo
   *  straddling the contour (its bloom also washes over the artwork's rim),
   *  'outside' = the interior half of every glow pass is punched out with
   *  the artwork's own alpha silhouette, so the halo hugs the PNG strictly
   *  from outside without ever covering the picture */
  imgvizGlowPlacement: 'over' | 'outside'
  /** Image style — electricity on/off (jagged bolts flickering off the
   *  artwork's alpha edge with the music) */
  imgvizBolt: boolean
  /** Image style — bolt color: the visualizer palette or its own */
  imgvizBoltMode: 'palette' | 'custom'
  /** Image style — bolt color when imgvizBoltMode = 'custom' */
  imgvizBoltColor: string
  /** Image style — bolt density 0..1 (how many bolts flicker per frame) */
  imgvizBoltDensity: number
  /** Image style — bolt reach multiplier 0.3..2 (1 = factory length) */
  imgvizBoltLength: number
}

/* --------------------------------- Background -------------------------------- */

export type BackgroundMode = 'solid' | 'gradient' | 'transparent' | 'image' | 'video'

export interface BackgroundConfig {
  mode: BackgroundMode
  /** Solid color (used when mode = solid) */
  color: string
  /** Optional second gradient used when mode = gradient */
  gradient: GradientConfig
  /** Image data URL (used when mode = image), drawn cover-fit */
  imageSrc: string
  /** Video/GIF data URL (used when mode = video); loops on the wall clock,
   *  muted unless the opt-in below is on */
  videoSrc: string
  /** Opt-in: play the background video's own audio through the engine —
   *  the clip's sound is analysed together with the track (the visualizer
   *  reacts to both) and plays through the master volume. Off by default,
   *  and meaningless for GIFs (which carry no sound). MP4 exports keep
   *  muxing the track's audio. */
  videoAudio?: boolean
  /** Horizontal image offset as a fraction of canvas width (0 = centered) */
  x: number
  /** Vertical image offset as a fraction of canvas height (0 = centered) */
  y: number
  /** Zoom multiplier on top of cover-fit (1 = image just covers the canvas) */
  scale: number
  /** Mirror the image horizontally (around its center) */
  flipX: boolean
  /** Mirror the image vertically (around its center) */
  flipY: boolean
  /** Darkening overlay over the image, 0..1 ("shade fader") */
  shade: number
  /** Vignette strength 0..1 (darkens edges) */
  vignette: number
  /** Subtle noise grain 0..1 */
  grain: number
  /** Blur the media (image or video/GIF background), 0..1 → up to ~40px */
  blur: number
  /** Beat bounce — media gently zooms with the bass, 0..1 (0 = steady) */
  pulse: number
  /** Beat shake — media jitters around with the bass, 0..1 (0 = steady) */
  shake: number
  /** Beat blur — extra blur that swells with the bass on top of the
   *  static `blur`, 0..1 (0 = off). Scales up to ~30px on a full hit. */
  blurPulse: number
  /** Flip on kick — the With the beat motion flips ON on every detected
   *  kick: the background rests still between kicks, the bounce/shake/
   *  blur swell stamp in at their dialed strength, hold for `flipHold`,
   *  then ease back to still (off = the motions follow the bass
   *  continuously). The same clean sub-band onset detector as the halftone
   *  print / 3D glasses flips, with its own state so the dials stay
   *  independent. */
  beatFlip: boolean
  /** Kick sensitivity 0..1 — how sharp a bass onset must be to fire the
   *  flip (lower = only the hardest slams, higher = every tap) */
  flipSensitivity: number
  /** Flip hold dial 0..1 (×2 s) — how long the beat motion stays fully on
   *  after a fired kick before the short 0.25 s ease back to still.
   *  0.2 = 0.4 s factory rest. */
  flipHold: number
}

/* ----------------------------------- Lyrics ---------------------------------- */

export interface LyricLine {
  /** Start time in seconds */
  time: number
  /** Line text */
  text: string
}

export interface LyricsConfig {
  enabled: boolean
  lines: LyricLine[]
  /** 'sans' | 'serif' | 'mono' — or the id of an imported custom font ("cf_…") */
  font: string
  size: number // px relative to 720p canvas
  weight: number // 300..800
  /** Vertical position 0..100 (50 = center) */
  positionY: number
  color: string
  /** Fade duration in seconds */
  fade: number
  /** Uppercase transform */
  uppercase: boolean
  /** Seconds a line stays before fading out when no newer line replaces it */
  holdTime: number
  /** The replaced line lingers in the echo slot above, dimmed, until the line
   *  after it arrives. Off = each line leaves the moment the next one shows. */
  echo: boolean
  /** Text fill: flat color, a gradient sweep, or empty (see-through — only
   *  the outline stroke and/or glow halo show) */
  fill: 'solid' | 'gradient' | 'empty'
  /** Where the gradient sweep gets its colors: the visualizer palette or lyrics' own */
  gradientMode: 'visualizer' | 'custom'
  /** Lyrics' own gradient (used when fill = gradient and gradientMode = custom) */
  gradient: GradientConfig
  /** Outline stroke behind the text */
  outline: boolean
  /** Outline stroke width, px relative to 720p canvas */
  outlineWidth: number
  outlineColor: string
  /** Soft glow halo behind the text */
  glow: boolean
  /** Glow blur strength 0..1 */
  glowStrength: number
  glowColor: string
  /** Overall text opacity 0..1 — 1 = fully opaque, 0 = invisible. Sits on
   *  top of every other alpha (fade-in, echo dim, auto-hide fade), scaling
   *  the whole lyric layer uniformly. */
  opacity: number
}

/* ----------------------------------- Title ------------------------------------ */

/**
 * Title card — a free-floating text (song title, artist…) that lives in its
 * own time window: fades in at `startTime`, holds for `duration` seconds,
 * fades out. Same styling language as the lyrics (fill sweep, outline, glow)
 * with its own palette option and a free X/Y position.
 */
export interface TitleConfig {
  enabled: boolean
  /** Title text — \n splits stacked lines */
  text: string
  /** Seconds into the song when the card appears */
  startTime: number
  /** Seconds the card stays on screen */
  duration: number
  /** Fade in/out seconds */
  fade: number
  /** 'sans' | 'serif' | 'mono' — or the id of an imported custom font ("cf_…") */
  font: string
  /** px relative to 720p canvas */
  size: number
  /** 300..800 */
  weight: number
  uppercase: boolean
  /** Horizontal position 0..100 (50 = centered) */
  positionX: number
  /** Vertical position 0..100 (50 = center) */
  positionY: number
  /** Audio-reactive size: 0 = fixed px · 1 = up to +100% bigger on the loudest sound */
  pulse: number
  /** Swivel — the block swings rotationally around its own center axis */
  swivel: boolean
  /** Swing amplitude in degrees (0..180) */
  swivelRange: number
  /** Full back-and-forth swings per second */
  swivelSpeed: number
  /** Text fill: flat color, a gradient sweep, or empty (see-through — only
   *  the outline stroke and/or glow halo show) */
  fill: 'solid' | 'gradient' | 'empty'
  color: string
  /** Where the gradient sweep gets its colors: the visualizer palette or the title's own */
  gradientMode: 'visualizer' | 'custom'
  /** Title's own gradient (used when fill = gradient and gradientMode = custom) */
  gradient: GradientConfig
  outline: boolean
  /** Outline stroke width, px relative to 720p canvas */
  outlineWidth: number
  outlineColor: string
  glow: boolean
  /** Glow blur strength 0..1 */
  glowStrength: number
  glowColor: string
}

/* -------------------------------- Pulse image -------------------------------- */

/**
 * Pulse image — a PNG/SVG logo or emblem that floats over (or behind) the
 * scene and breathes with the music, like the blob/radial styles react.
 * Scale swells on bass+energy; optional slow spin and a palette-tinted aura.
 */
export interface PulseImageConfig {
  enabled: boolean
  /** Image (data URL) — transparency strongly recommended */
  imageSrc: string
  /** Center, 0..100 (of width / height) */
  x: number
  y: number
  /** Rest size as % of canvas height */
  size: number
  /** Audio-reactive swell 0..1 (0 = static, 1 = up to +35% on the loudest hit) */
  pulse: number
  /** Slow continuous rotation */
  spin: boolean
  /** Spin speed multiplier for the rotation (1 = the classic slow turn) */
  spinSpeed: number
  /** Soft aura behind the image */
  glow: boolean
  /** Where the glow takes its color: 'palette' tints it with the visualizer
   *  palette (pre-glow-color behavior), 'custom' uses `glowColor`. Default
   *  keeps old saves/share links rendering exactly as before. */
  glowColorMode: 'palette' | 'custom'
  /** Glow color when glowColorMode = 'custom' (#rgb / #rrggbb / #rrggbbaa) */
  glowColor: string
  /** Glow strength 0..1 — how hard the aura shines (bake density and the
   *  additive pass both scale with it; missing on old saves → 0.7) */
  glowStrength: number
  /** Beat color overlay strength 0..1 — washes the image in a color that
   *  shifts from `tintLow` at silence to `tintHigh` at the loudest level
   *  (0 = the artwork keeps its own colors) */
  tint: number
  /** Beat overlay color when quiet (silence) */
  tintLow: string
  /** Beat overlay color at the loudest level */
  tintHigh: string
  /** Outline stroke traced around the image's alpha silhouette; the glow
   *  shadow is cast by the stroked composite, so the aura follows the ring */
  outline: boolean
  /** Outline width 0..1 — % of the larger image dimension (up to 10%) */
  outlineWidth: number
  /** Outline color (#rgb / #rrggbb / #rrggbbaa) */
  outlineColor: string
  /** Layer order vs. the vinyl & visualizer (same semantics as the bars) */
  layer: 'front' | 'back'
}

/* --------------------------------- Watermark --------------------------------- */

/**
 * Corner watermark — a small logo image or @handle text sitting on top of
 * everything (exports included), so posted videos stay credited.
 */
export interface WatermarkConfig {
  enabled: boolean
  /** Logo image (data URL, transparency welcome). Wins over text when set. */
  imageSrc: string
  /** Text mode: a short handle like "@you" (shown when no image is set). */
  text: string
  /** Which corner to sit in */
  position: 'tl' | 'tr' | 'bl' | 'br'
  /** Logo height / text size, px relative to the 720p canvas */
  size: number
  /** 0..1 — how strongly the watermark shows */
  opacity: number
}

/* ------------------------------------ Disc ------------------------------------ */

/**
 * Album art layer — a square cover with a spinning disc, like a record
 * sliding out of its sleeve. One image powers both: the square cover shows it
 * flat, and the disc carries it either on the vinyl's center label (black
 * grooved face around it) or across the full face like a CD. Purely
 * decorative: deterministic spin on the style clock, optional audio pulse.
 */
export interface DiscConfig {
  enabled: boolean
  /** Album art (data URL) — powers the square cover; the disc reuses it
   *  unless a separate disc image is set below */
  imageSrc: string
  /** Separate image (data URL) for the disc face only — the vinyl label,
   *  CD face or cassette label. Empty = reuse the shared album art. */
  discImageSrc: string
  /** Show the square cover (the "sleeve") */
  showCover: boolean
  /** Cover side length as % of canvas height */
  coverSize: number
  /** Cover center, 0..100 (of width / height) */
  coverX: number
  coverY: number
  /** Art zoom inside the sleeve on top of cover-fit (1 = fills the square) */
  coverArtZoom: number
  /** Which part of the art shows in the sleeve, 0..100 (50 = centered) */
  coverArtX: number
  coverArtY: number
  /** Show the spinning disc */
  showDisc: boolean
  /** Disc face: art on the vinyl's center label, across the full face like a
   *  CD, or a whole cassette tape with turning hubs */
  mode: 'label' | 'full' | 'cassette'
  /** Disc diameter as % of canvas height */
  discSize: number
  /** Disc center, 0..100 (of width / height) */
  discX: number
  discY: number
  /** Draw the disc in front of the square cover instead of peeking out behind it */
  discInFront: boolean
  /** Art zoom on the disc face/label on top of cover-fit (1 = fills it) */
  discArtZoom: number
  /** Which part of the art shows on the disc face/label, 0..100 (50 = centered) */
  discArtX: number
  discArtY: number
  /** Cassette drawing style: clean flat illustration or shaded photoreal render */
  cassetteStyle: 'vector' | 'realistic'
  /** Cassette shell plastic color */
  shellColor: string
  /** Cassette label: bare plastic, the album art, or the built-in mixtape label */
  cassetteLabel: 'none' | 'art' | 'default'
  /** Mixtape label stripe colors (top → bottom) */
  stripes: string[]
  /** Mixtape label top strip background (the ruled-lines card) */
  labelColor: string
  /** Text written on the mixtape label — \n stacks lines on the rules */
  labelText: string
  /** Mixtape label text color */
  labelTextColor: string
  /** Drop-shadow depth behind the cover / disc / cassette, 0..100 (0 = off) */
  shadowDepth: number
  /** Shadow direction in degrees — 0 right · 90 down · 180 left · 270 up */
  shadowAngle: number
  /** Shadow color — black by default; pick a lighter/colored one for dark backgrounds */
  shadowColor: string
  /** Spin speed in rotations per minute (33.33 ≈ LP, 45 ≈ single) */
  rpm: number
  /** Spin direction: 1 = clockwise, -1 = counter-clockwise */
  direction: 1 | -1
  /** Audio-reactive size pulse 0..1 (0 = steady) */
  pulse: number
  /** Vinyl groove rings on the black face (label mode) */
  grooves: boolean
  /** Fixed light sheen across the face 0..1 */
  sheen: number
}

/* ------------------------------- Screen filter ------------------------------- */

/**
 * Screen filter — a post-pass drawn over the ENTIRE composed frame
 * (visualizer, disc, lyrics, title, watermark included), like the picture on
 * a physical display. Deterministic: no time, no randomness — same config
 * over the same frame always yields the same pixels, so exports stay
 * frame-exact. Skipped entirely on transparent backgrounds so alpha
 * recordings stay clean.
 *
 * v1 ships the CRT look: horizontal scanlines, an RGB phosphor aperture
 * grille, chromatic aberration (R/B channel split) and a soft bloom.
 */
export interface ScreenFilterConfig {
  enabled: boolean
  /** Mask cell size in px on the 720p reference canvas (2..8) — scanline
   *  pitch and the width of each R/G/B phosphor stripe scale with it */
  size: number
  /** Scanline darkness 0..1 (the horizontal dark rows) */
  scanlines: number
  /** RGB aperture-grille strength 0..1 (the vertical phosphor stripes) */
  grille: number
  /** Chromatic aberration 0..1 — up to ~3.5px R/B split at 720p */
  aberration: number
  /** Soft bloom/glow 0..1 (the picture's light bleeding like on a tube) */
  glow: number
  /** React to beat — every kick jolts the tube: the color split widens past
   *  the dial (additive, visible even at low Color Split), the glow flares
   *  and the screen brightens; between beats the look stays exactly as
   *  dialed in */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * VHS filter — plays the picture off a worn-out tape: per-line horizontal
 * wobble, a rolling tracking-noise band and white dropout specks. Motion is
 * derived from song time via integer hashing (no Math.random / Date.now), so
 * exports stay frame-exact. Skipped on transparent backgrounds like the CRT.
 */
export interface VhsFilterConfig {
  enabled: boolean
  /** Horizontal line wobble 0..1 (slow wave + per-band tape jitter) */
  wobble: number
  /** Tracking-noise band intensity 0..1 (band thickness + noise strength) */
  tracking: number
  /** Tracking band cadence 0..1 — how often a pass rolls through and how
   *  fast it sweeps; independent of `tracking` so the band can stay strong
   *  while appearing rarely. 1 = rolls continuously, lower = the tape
   *  behaves for a while between passes. */
  trackingSpeed: number
  /** White dropout streaks 0..1 (density) */
  dust: number
  /** React to beat — wobble, tracking and dropouts all punch harder on the
   *  song's low end; between beats the tape plays exactly as dialed in.
   *  Cadence (`trackingSpeed`) stays decoupled — the beat never changes
   *  WHEN the band rolls, only how violent it looks while it does. */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Camcorder filter — effect.app's "Backrooms" preset ported 1:1 (captured
 * verbatim from the live editor) as the camcorder sibling of the VHS tape:
 * the whole picture plays back through a lo-fi analog tape pipeline — a
 * PAL-style YIQ chroma decoder on an internal low-resolution grid, tape
 * wobble / crease tears / tracking noise / 29.97fps vertical jumps — then
 * the preset's Oklab zone color grade (the yellow-green tape cast) and a
 * soft gaussian haze over it all. Dials match the original effect's
 * controls; the grade zone values are the preset's own, baked in. All noise
 * is hash-based, so exports are frame-exact. Skipped on transparent
 * backgrounds.
 */
export interface CamcorderFilterConfig {
  enabled: boolean
  /** Internal tape resolution — the lo-fi resample grid width, 128..1024
   *  (the original "resolution" dial; its default 420 ≈ VHS tape) */
  resolution: number
  /** Distortion 0..2.5 — how far the tape bends the lines */
  distortion: number
  /** Color fringing 0..2 — the chroma carrier phase rotation (hue smear) */
  colorFringing: number
  /** Wobble 0..2 — the slow horizontal tape wave */
  wobble: number
  /** Tape crease 0..2 — the tearing wrinkle that slides down the tape */
  tapeCrease: number
  /** Tracking noise 0..2 — the head-switch smear at the frame's bottom */
  trackingNoise: number
  /** Vertical jump 0..2 — frame-quantized tape skips (29.97 fps) */
  verticalJump: number
  /** Sparkle 0..2 — bright glitter riding the tape crease */
  sparkle: number
  /** Flicker 0..2 — the slow AC-power brightness breathing */
  flicker: number
  /** Grain 0..2 — RGB tape grain */
  grain: number
  /** Saturation 0..2.5 — chroma gain after the tape decode */
  saturation: number
  /** Color shift 0..2 — the YIQ tint skew (the backrooms yellow-green) */
  colorShift: number
  /** Color blend 0..1 — how much of the decoded chroma lands (1 = full) */
  colorBlend: number
  /** Softness 0.4..2 — luma low-pass bandwidth (lower = softer tape) */
  softness: number
  /** Color delay 0..8 — chroma horizontal offset in tape pixels */
  colorDelay: number
  /** Sharpening 0..2 — edge crispness applied after the resample */
  sharpening: number
  /** Gaussian blur strength 0.3..50 — the haze kernel radius scale
   *  (radius ≈ strength × 2.64 px per pass, exactly the original) */
  blur: number
  /** Blur mix 0..1 — how much of the blurred frame lands over the graded
   *  one (the preset ships 0.05: a faint haze) */
  blurMix: number
  /** Grade strength 0..1 — the baked Backrooms color grade's master dial */
  gradeStrength: number
  /** React to beat — kicks jolt the tape: tracking noise, tape crease and
   *  the vertical jump punch past their dials (additive, resting exactly at
   *  the dialed look between beats) */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Film filter — old school film reel damage: persistent vertical emulsion
 * scratches (re-drawn every few seconds), dust specks & hairs, and
 * frame-by-frame exposure flicker. Deterministic via song time + hashing.
 */
export interface FilmFilterConfig {
  enabled: boolean
  /** Vertical scratch count/opacity 0..1 */
  scratches: number
  /** Dust specks & hairs 0..1 (density) */
  dust: number
  /** Reel speed 0..1 — how fast dust pops in/out and scratches wander.
   *  Cadence only: it never changes how many artifacts there are, that is
   *  the scratches/dust dials. Default 0.5 = the classic 16 fps silent-film
   *  projection churn; 0 = the reel barely turns, 1 = frantic. */
  speed: number
  /** Exposure flicker 0..1 (per-film-frame brightness wobble) */
  flicker: number
  /** React to beat — scratches/dust darken and the lamp flares on the
   *  song's low end; between beats the reel plays exactly as dialed in */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Halftone filter — newspaper print: the picture is sampled on a rotated
 * (45°) dot grid and darker tones turn into halftone dots while lighter
 * areas stay untouched. `dotRange` is the user-facing "only darker colors"
 * control: it sets how dark a tone must be before it gets dotted.
 *
 * The picture itself can be conditioned before printing (`grayscale`,
 * `contrast`, `invert`) and the ink can be any color, optionally a
 * two-color gradient whose angle drifts with song time and swings with the
 * low end (`gradientMotion` scales both).
 */
export interface HalftoneFilterConfig {
  enabled: boolean
  /** Dot cell size in px on the 720p reference canvas (3..14) */
  dotSize: number
  /** Shadow range 0..1 — luminance threshold below which tones become
   *  dots (0 = only pure black, 1 = the whole picture) */
  dotRange: number
  /** Dot ink strength 0..1 */
  strength: number
  /** React to beat — the print LIFTS on the song's low end (dots shrink
   *  back, ink fades and the shadow range narrows so the clean picture
   *  pops through for a moment); between beats the print stays exactly
   *  as dialed in */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
  /** Flip on kick — between kicks the frame rests as the halftone print;
   *  every kick lifts the whole look (print and, if on, the negative)
   *  clean off so the untouched regular picture flashes through, then the
   *  print settles back until the next kick */
  beatFlip: boolean
  /** Which side of the Flip on kick swap the kick reveals:
   *  'picture' (default) = the print rests on the frame between kicks and
   *  every kick flashes the untouched regular picture (the original
   *  behavior); 'print' = the mirror image — the regular picture rests on
   *  the frame between kicks and every kick stamps the halftone print in,
   *  then it fades back out. Only matters while beatFlip is on. Old saves
   *  without this field load as 'picture'. */
  beatFlipTo: 'picture' | 'print'
  /** Flip on kick sensitivity 0..1 — how sharp a low-end hit must land
   *  before the swap fires. The detector listens for the HIT on a clean
   *  sub-bass channel (raw samples, not the dB-clipped spectrum meters,
   *  which pin at their ceiling in loud sections) and tracks how fast the
   *  bass rises against a rolling-median bar, so long bass notes never pin
   *  the swap open, steady kick patterns never raise the bar into missing
   *  their own kicks, and quiet passages still fire on real kicks. 0.5
   *  (default) is a balanced gate; lower values raise the bar until only a
   *  true slam flips it, higher values drop it to "every hit". Only matters
   *  while beatFlip is on. Old saves without this field load as 0.5. */
  flipSensitivity: number
  /** Flip on kick hold 0..1 — how long the swap stays FULLY swapped after
   *  a fired kick before it fades back (the dial spans 0–2 s; the release
   *  itself is a fixed 0.25 s). Factory default 0.2 (0.4 s) holds each
   *  kick about a beat before the fade-back. Only matters while beatFlip
   *  is on. Old saves without this field load as 0.2. */
  flipHold: number
  /** Stay black & white — the kick side of the Flip on kick swap keeps the
   *  picture conditioning (Grayscale / Contrast) instead of flashing back
   *  to the untouched full-color picture, so only the dots come and go.
   *  Meaningful once a conditioning dial is set (e.g. Grayscale on); a
   *  no-op otherwise. Only matters while beatFlip is on. */
  flipMono: boolean
  /** Black & white — desaturate the whole picture before printing */
  grayscale: boolean
  /** Picture contrast 0..1 — 0.5 is the untouched picture, 0 flattens
   *  toward mid-gray, 1 doubles the punch (maps to CSS contrast 0..2) */
  contrast: number
  /** Invert the picture to a negative — applied after the halftone screen
   *  has read the tones, so the print stays exactly where it was (feeding
   *  the negative to the screen instead would leave a dark scene with no
   *  dark tones below the threshold and wipe the whole print off) */
  invert: boolean
  /** Halftone ink color as '#rrggbb' (default black = classic print) */
  inkColor: string
  /** Two-color gradient ink instead of one flat color. The gradient lives
   *  INSIDE the dots, so turning it on prints poster-style on its own — the
   *  picture steps off the frame and only the halftone shows on the
   *  backdrop (never dots layered over the image). Switching the fill back
   *  to Ink returns the classic print over the picture. */
  gradient: boolean
  /** Gradient's second color as '#rrggbb' (only matters when gradient) */
  inkColor2: string
  /** How much the gradient moves with the sound 0..1 — scales both the
   *  slow constant drift and the swing driven by the song's low end
   *  (0 = static gradient) */
  gradientMotion: number
  /** Print only — poster mode: the picture is wiped off the frame entirely
   *  and only the halftone print remains, sitting on the Backdrop below (a
   *  solid color, or a two-color gradient you dial in). The dots still
   *  follow the hidden picture — the screen samples the composed frame
   *  BEFORE it is hidden — so the print keeps dancing with the music, and
   *  Flip on kick becomes "lift the print clean off": a kick reveals the
   *  bare backdrop, never the hidden picture. Old saves without this field
   *  load as off (the classic print over the picture). */
  printOnly: boolean
  /** Poster backdrop color as '#rrggbb' — the "paper" the print sits on
   *  while the poster is up (Print only, or a Gradient / Picture fill,
   *  which print poster-style on their own; factory white = classic print
   *  on paper). Ignored while the classic print covers the picture. */
  backdropColor: string
  /** Two-color gradient backdrop instead of one flat color (only matters
   *  while the poster is up — Print only, or a Gradient / Picture fill) */
  backdropGradient: boolean
  /** Backdrop gradient's second color as '#rrggbb' (only matters while
   *  the poster is up AND the backdrop gradient is on) */
  backdropColor2: string
  /** How much the backdrop gradient moves with the sound 0..1 — the same
   *  motion engine as the ink gradient (slow drift + kick swing, 0 =
   *  static). Only matters while the poster is up AND the backdrop
   *  gradient is on. */
  backdropMotion: number
  /** Fill the dots with the picture's own colors — a color halftone: every
   *  dot carries the color the picture has where that dot sits. The fill
   *  lives INSIDE the dots, so it prints poster-style on its own — the
   *  picture steps off the frame and only the halftone shows on the
   *  backdrop (never dots layered over the image); the screen samples the
   *  hidden snapshot, so Black & white / Contrast shape what the dots
   *  carry. Wins over the Ink color / Gradient while on. Factory false =
   *  the classic ink fill (dots over the picture). */
  imageFill: boolean
}

/**
 * Dither filter — retro ordered dithering over the whole frame: the picture
 * is resampled onto a chunky grid, every cell is thresholded against a tiled
 * 8×8 Bayer matrix, and each cell repaints either the dark tone or the bright
 * tone, so brightness spreads into dot patterns like old 1-bit screens and
 * dither-poster art. A two-pass additive bloom over the bright dots adds the
 * glowing look. Deterministic (no randomness — same frame in, same pixels
 * out), so exports match the preview frame-exactly. Skipped on transparent
 * backgrounds.
 */
export interface DitherFilterConfig {
  enabled: boolean
  /** Palette: 'blue' = the "all shades of blue" glowing poster (deep-navy
   *  paper, bright cells climb a navy → royal → electric → sky → ice ladder
   *  by their luminance), 'mono' = classic 1-bit black & white, 'color' =
   *  retro per-channel quantization (3 levels each, Bayer-steered),
   *  'custom' = your own two colors, 'macpaint' = effect.app's MacPaint
   *  engine — 38 hand-crafted 8×8 bitmap patterns picked per cell by
   *  density matching (no Bayer matrix), with its own threshold curve,
   *  edge stamping, smoothing and sharpen dials */
  mode: 'blue' | 'mono' | 'color' | 'custom' | 'macpaint'
  /** Blue glow palette: the glow color as '#rrggbb' (mode 'blue') — the
   *  bright cells' shade ladder is rebuilt from this color's hue, so the
   *  default pick reproduces the original all-blue ramp exactly */
  blueInkColor: string
  /** Blue glow palette: the dark paper behind the dots as '#rrggbb'
   *  (mode 'blue') */
  bluePaperColor: string
  /** Dither cell size in px on the 720p reference canvas (2..14) */
  cellSize: number
  /** Picture contrast 0..1 — 0.5 is the untouched picture, 1 doubles the
   *  punch (maps to CSS contrast 0..2), applied before the screen reads the
   *  tones so the dither follows the picture the user actually sees */
  contrast: number
  /** Dither strength 0..1 — how much of the frame the print takes over
   *  (below 1 the untouched frame fades back through) */
  strength: number
  /** Glow 0..1 — the additive bloom over the bright dither dots */
  glow: number
  /** Custom palette: the bright dots' color as '#rrggbb' (mode 'custom') */
  inkColor: string
  /** Custom palette: the dark cells' color as '#rrggbb' (mode 'custom') */
  paperColor: string
  /** React to beat — the Bayer engines' glow flares on the song's low end
   *  and MacPaint's Threshold dips on each detected kick (the ink recedes,
   *  the print lifts toward clean paper — the same kick-onset gate as the
   *  flip features, resting exactly at the dialed value between kicks);
   *  between beats the dither plays exactly as dialed in */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) —
   *  the flare size on the glowing engines, the Threshold dip on
   *  MacPaint (a full kick at 100% moves it −0.35) */
  beatStrength: number
  /** MacPaint: which of the 38 bitmap patterns the density matcher may
   *  pick from — array of pattern slot indices 0..37. The published preset
   *  enables slots 0, 2, 6, 17, 28, 33, 36, 37 (a spread from clean paper
   *  to solid ink; slot 0 is the empty screen, so the brightest tones print
   *  unbroken paper); the card's swatch grid toggles them. Old saves
   *  without the field load as that published spread. */
  macPatterns: number[]
  /** MacPaint: bitmap width 32..4096 — the dither grid is sized so the
   *  LONGER frame side spans this many cells (the real effect's own
   *  sizing; a working GPU prints the dial verbatim — its cost is per
   *  output pixel, so 4096 runs free — while the CPU fallback caps the
   *  live grid for interactivity) */
  macBitmapWidth: number
  /** MacPaint: threshold 0..1 — the tone the 50% density pivot sits at
   *  (published 0.354) */
  macThreshold: number
  /** MacPaint: contrast 0.1..4 — how hard tones snap across the threshold
   *  pivot (published 2.5; higher = fewer mid patterns, lower = smoother
   *  density ramps) */
  macContrast: number
  /** MacPaint: grain 0..1 — jitters the density lookup per cell with
   *  deterministic hash noise so flat areas break up (published 0) */
  macGrain: number
  /** MacPaint: smooth 0..3 cells — flattens noise into even tones while
   *  keeping edges (picks the flattest diagonal quadrant per cell by
   *  variance; published 1) */
  macSmoothing: number
  /** MacPaint: sharpen −1..2 — unsharp mask over the cell colors;
   *  negative values denoise (published −0.83), positive crisp edges */
  macSharpen: number
  /** MacPaint: radius 0.5..5 cells — the sharpen/denoise stencil reach
   *  (published 1.2) */
  macRadius: number
  /** MacPaint: edges — 0 = Off, 1 = Ink (stamps solid ink along picture
   *  edges), 2 = Shade (pushes edges toward paper so patterns read around
   *  them). Published default Ink. */
  macEdgeMode: number
  /** MacPaint: edge threshold 0.01..1 — how strong a Sobel gradient must
   *  be to count as an edge (published 0.1) */
  macEdgeThreshold: number
  /** MacPaint: edge width 0.5..3 cells — the Sobel sample reach
   *  (published 1.1) */
  macEdgeWidth: number
  /** MacPaint: the ink the dark pattern dots print in, '#rrggbb'
   *  (published near-black #0f0f12) */
  macInkColor: string
  /** MacPaint: the paper behind the pattern dots, '#rrggbb' (published
   *  warm paper white #f7f5eb) */
  macPaperColor: string
}

/** The tile geometries the Cubify grid can cut its cells into, in canonical
 *  order (the order shapes are stored and mixed in). The cube is the
 *  original effect.app look; the rest warp the same depth dial radially,
 *  diagonally or folded so the read changes but the dial semantics stay. */
export type CubifyShape = 'cube' | 'circle' | 'oval' | 'diamond' | 'triangle'

/** Canonical order of the Cubify tile shapes (storage + mix order). */
export const CUBIFY_SHAPE_ORDER: CubifyShape[] = ['cube', 'circle', 'oval', 'diamond', 'triangle']

/**
 * Cubify filter — effect.app's Cubify effect, ported 1:1 from its shader
 * (captured from the live editor) over the whole finished picture: the
 * frame's coordinates are rotated, snapped onto an exponentially-scaled grid
 * and warped INSIDE every cell — the cell's fractional position is pushed
 * toward the cell edges by an iterated smoothstep ("depth distortion") —
 * then un-transformed and resampled. The result reads as the picture
 * refracted through an array of beveled glass tiles. The tile shape is
 * mixable (`shapes`): the original cube, a radial glass bead (circle), a
 * squashed bead (oval), a 45°-twisted gem (diamond) or a folded prism
 * (triangle) — one shape tiles every cell, two alternate in a checkerboard,
 * three or more shuffle cell by cell by a stable hash that scrolls with the
 * grid. "Hard edges" snaps the warp to each shape's landmarks instead,
 * "dispersion" splits the warp per RGB channel. The grid can rotate, drift
 * (animation speed) and be offset. Deterministic (no randomness — same
 * frame in, same pixels out), so exports match the preview frame-exactly.
 * Skipped on transparent backgrounds.
 */
export interface CubifyFilterConfig {
  enabled: boolean
  /** Tile shapes — which cell geometries the grid cuts into, always stored
   *  in CUBIFY_SHAPE_ORDER order (the UI rebuilds the array canonically).
   *  One entry tiles the whole grid; two checkerboard (even cells take the
   *  first, odd the second); three or more shuffle per cell by a stable
   *  hash. The factory single 'cube' is byte-identical to the original
   *  effect.app shader path. */
  shapes: CubifyShape[]
  /** Cube size — the logarithmic grid scale, 0..8 (effect.app's dial, its
   *  default 0.6 ≈ 3.6 cubes across the short side; the cell size is
   *  exp(-scale) of the half-height) */
  scale: number
  /** Cube stretch -1..1 — squashes the grid horizontally (positive) or
   *  vertically (negative) before the warp */
  stretch: number
  /** Depth distortion 0..5 — the per-cell edge pull: how many whole
   *  smoothstep warps apply inside every cube (the 3D depth of the look) */
  depth: number
  /** Hard edges — snap the warp to the cell's four corners (hard pixels)
   *  instead of the smooth glass refraction */
  hard: boolean
  /** Rotation angle of the cube grid, 0..90 degrees */
  angle: number
  /** Position offset of the grid, -1..1 in grid cells */
  offsetX: number
  offsetY: number
  /** Animation speed — the grid drifts this many cells per second while
   *  the song plays (the decorative style clock: it keeps drifting while
   *  the preview is paused and freezes to song time in exports) */
  speedX: number
  speedY: number
  /** Dispersion 0..1 — the warp strength splits per RGB channel, fringing
   *  the cube edges like chromatic glass */
  dispersion: number
  /** Mix 0..1 — how much of the frame the cube print takes over (below 1
   *  the untouched frame fades back through) */
  blend: number
  /** React to beat — the depth distortion punches deeper on the song's
   *  low end (driven by frame.bass, additive, resting exactly at the
   *  dialed look between kicks); dispersion is NOT beat-driven and stays
   *  exactly where its dial sits */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Kaleidoscope filter — the whole picture mirrored through a radial array
 * of wedge slices around a center point: every wedge shows the same slice
 * of the picture, treated per the segment style (classic alternating
 * reflections, all-mirrored mandala, or a direct pinwheel fan), spinning
 * slowly and zoomable. The SOURCE can drift around under the mirrors
 * (wander + breathe + beat snap), so a still background image reads as a
 * working kaleidoscope instead of one stationary mirrored picture.
 * Deterministic (motion derives from the decorative style clock and
 * integer hashes, no randomness), so exports match the preview
 * frame-exactly. Skipped on transparent backgrounds.
 */
export interface KaleidoscopeFilterConfig {
  enabled: boolean
  /** Mirror wedges around the center, 2..24 (2 = a plain two-way mirror) */
  segments: number
  /** Spin — the whole mirror array rotates this many turns per second,
   *  -0.5..0.5 (negative spins the other way) */
  spin: number
  /** Zoom into the slice, 1..4 (1 = the auto-cover framing, higher
   *  magnifies the slice) */
  zoom: number
  /** Segment style — how each wedge treats the slice: 'alternate' is the
   *  classic tiling (odd wedges mirrored, every seam reads as a clean
   *  reflection); 'mandala' mirrors EVERY wedge about its own axis (a ring
   *  of self-symmetric butterflies); 'direct' never mirrors (the slice
   *  repeats rotationally, a pinwheel fan with hard seams) */
  mirrorMode: 'alternate' | 'mandala' | 'direct'
  /** Source drift — the sampled picture wanders around under the mirrors,
   *  0..1 as a share of the frame. 0 keeps the slice still (the mirror
   *  print of a still background image then freezes into one picture);
   *  a drifting source is what makes a still image read as a WORKING
   *  kaleidoscope — the wedges keep re-slicing a moving picture */
  wander: number
  /** Drift speed, 0..3 cycles/s — how fast the wander runs its path
   *  (0 freezes it; the path itself is a Lissajous of two incommensurate
   *  sines, so it never repeats) */
  wanderSpeed: number
  /** Breathe, 0..1 — the slice swells up to +40% zoom on a slow sine
   *  (zoom-in only, so the auto-cover guarantee never breaks) */
  breathe: number
  /** Kaleidoscope center, 0..100 % of the frame */
  centerX: number
  centerY: number
  /** Mix 0..1 — how much of the frame the mirror print takes over (below 1
   *  the untouched frame fades back through) */
  blend: number
  /** React to beat — on the song's low end the array kicks around an extra
   *  wedge AND the source snaps to a fresh hashed spot (the pattern
   *  re-forms on every kick; driven by frame.bass, additive, resting
   *  exactly at the dialed look between kicks) */
  beatReactive: boolean
  /** How hard the beat kick hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Water wave filter — the whole picture ripples like a reflection on
 * water: the frame is redrawn in thin horizontal strips, every strip
 * shifted sideways by a sine whose phase rolls down the frame and drifts
 * with the decorative style clock (each strip draws twice, wrapped, so the
 * shifted edges stay seamless). Deterministic (same frame in, same pixels
 * out), so exports match the preview frame-exactly. Skipped on transparent
 * backgrounds.
 */
export interface WaveWarpFilterConfig {
  enabled: boolean
  /** Ripple height in px on the 720p reference canvas, 0..120 */
  amplitude: number
  /** Ripples — full waves from the frame's top edge to its bottom, 0.5..8 */
  density: number
  /** Flow speed — the ripple pattern drifts this many cycles per second,
   *  0..3 */
  speed: number
  /** Mix 0..1 — how much of the frame the rippled print takes over (below
   *  1 the untouched frame fades back through) */
  blend: number
  /** React to beat — the ripples swell deeper on the song's low end
   *  (driven by frame.bass, multiplicative, resting exactly at the dialed
   *  look between kicks) */
  beatReactive: boolean
  /** How hard the beat wobble hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Vignette filter — the lens works the frame's edges one of two ways,
 * chosen on the card (either function, one at a time): COLOR — the classic
 * elliptical falloff centered on the picture (transparent at the center,
 * the tint color fading in toward the corners), or EDGE BLUR — the same
 * elliptical falloff but the edges read a blurred copy of the picture
 * instead of a darkened one (a frosted lens rim). Reach / softness dials
 * shape the falloff either way. Deterministic, skipped on transparent
 * backgrounds.
 */
export interface VignetteFilterConfig {
  enabled: boolean
  /** Strength 0..1 — how dark (color mode) or how blurred (blur mode)
   *  the edges get */
  amount: number
  /** Reach 0..1 — how far in from the corners the effect starts */
  reach: number
  /** Softness 0..1 — the falloff's feather (0 = a hard lens edge,
   *  1 = the longest smooth fade) */
  softness: number
  /** Edge blur — the lens blurs the picture toward the edges instead of
   *  laying the tint over them (false = the classic color shadow, true =
   *  a frosted rim; the tint picker hides while this owns the card) */
  edgeBlur: boolean
  /** Edge tint as '#rrggbb' — near-black keeps the classic neutral lens;
   *  a hue casts a colored shadow into the corners (color mode only) */
  tintColor: string
  /** React to beat — the vignette darkens deeper on the song's low end
   *  (driven by frame.bass, additive, resting exactly at the dialed look
   *  between kicks) */
  beatReactive: boolean
  /** How hard the beat pulse hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Camera shake filter — the finished picture is reframed like handheld
 * footage: the whole frame drifts around on a smooth two-sine wander,
 * rolls a fraction of a degree with it, and jolts sharply on the song's
 * low end when "React to beat" is on (each kick's direction hashed from
 * the song time, so exports kick the exact same way). An overscan scale
 * keeps the moved frame from ever revealing its edges. Deterministic, so
 * exports match the preview frame-exactly. Skipped on transparent
 * backgrounds.
 */
export interface ShakeFilterConfig {
  enabled: boolean
  /** Handheld drift in px on the 720p reference canvas, 0..60 */
  amount: number
  /** Drift speed — how fast the handheld wander circles, 0..3 */
  speed: number
  /** Roll wobble — the frame tilts this many degrees with the drift, 0..2 */
  wobble: number
  /** React to beat — a sharp jolt kicks the frame on the song's low end
   *  (driven by frame.bass, additive, resting exactly at the dialed drift
   *  between kicks) */
  beatReactive: boolean
  /** How hard the beat jolt hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Strobe filter — the screen flashes to its NEGATIVE at random intervals:
 * every flash inverts the colors on screen for a split second, like a strobe
 * light firing in front of the camera. The Frequency dial sets how often the
 * strobe fires on average (the gaps between flashes stay random — each
 * flash's moment is hashed from the song time, so exports flash frame-
 * exactly); Mix fades the inverted print back over the untouched frame.
 * Optional color overlay: the inverted flash takes the overlay color's hue
 * instead of a pure negative, and the overlay hue itself can roll fresh on
 * every flash when "randomize color" is on. React to beat fires the strobe
 * on the song's low end too. Skipped on transparent backgrounds like every
 * full-frame filter.
 */
export interface StrobeFilterConfig {
  enabled: boolean
  /** Frequency — average flashes per second, 0..8. The flashes land at
   *  RANDOM intervals around this average (0 silences the schedule: only
   *  the beat fires the strobe when React to beat is on) */
  frequency: number
  /** Mix 0..1 — how completely the flash inverts (below 1 the untouched
   *  frame fades back through) */
  mix: number
  /** Color overlay — the inverted flash takes the overlay color's hue
   *  (the negative keeps its flipped luminosity) instead of a pure
   *  black/white negative */
  colorOverlay: boolean
  /** The overlay hue as '#rrggbb' (only shows while colorOverlay is on
   *  and the per-flash color roll is off) */
  overlayColor: string
  /** Randomize color on beat — every flash lands a fresh random hue
   *  instead of the dialed overlay color (only matters when colorOverlay
   *  is on) */
  randomColorOnBeat: boolean
  /** React to beat — the song's low end fires the strobe too (a real kick
   *  flashes the screen, between kicks the frame rests at the dialed look) */
  beatReactive: boolean
  /** How hard a kick must hit (and how fully it flashes), 0..1 */
  beatStrength: number
}

/**
 * Phosphor monitor filter — the lo-fi sci-fi video-tube look: the whole
 * picture is repainted as glowing vertical lines or columns of short
 * horizontal dashes (one sample per cell, tone → shade of the picked
 * phosphor color via the shared glow ladder from shade-ladder.ts), over a
 * dark tube built from the frame itself, with an additive bloom on the
 * bright print. Skipped on transparent backgrounds.
 */
export interface PhosphorFilterConfig {
  enabled: boolean
  /** Print style — 'lines' = continuous glowing vertical lines (the
   *  scanline tube look), 'dashes' = columns of stacked glowing ticks */
  mode: 'lines' | 'dashes'
  /** The phosphor glow color as '#rrggbb' — the shade ladder rebuilds
   *  from this hue (same ladder the dither Blue glow uses) */
  inkColor: string
  /** The dark tube behind the print as '#rrggbb' */
  paperColor: string
  /** Line/dash cell size in px on the 720p reference canvas (3..12) */
  cellSize: number
  /** Spacing between the lines/dashes 0..0.6 — 0 melts the columns solid,
   *  higher thins the print apart */
  gap: number
  /** Picture contrast 0..1 — 0.5 is the untouched picture, 1 doubles the
   *  punch (same semantics as the dither filter) */
  contrast: number
  /** Strength 0..1 — how much of the frame the monitor print takes over
   *  (below 1 the untouched frame fades back through) */
  strength: number
  /** Glow 0..1 — the real phosphor halo radiating around the print (the
   *  print's own colors never change — the halo only adds light around it) */
  glow: number
  /** React to beat — the halo flares on the song's low end */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Contour filter — the woven-thread waveform look (glowing contour lines
 * re-materialize the whole picture and ride the music like a waveform
 * field).
 */
export interface ContourFilterConfig {
  enabled: boolean
  /** How many horizontal lines the picture is woven into (24..160) */
  lines: number
  /** Warp 0..1 — how strongly the picture's bright shapes bend the lines
   *  around themselves (the contour/silhouette effect) */
  warp: number
  /** Drift 0..1 — how much the lines sway on their own between beats */
  motion: number
  /** Reactivity 0..1 — how hard the music ripples the lines (each line is
   *  driven by its own frequency bin, so the field rides the spectrum) */
  reactivity: number
  /** The line ink as '#rrggbb' — the shade ladder rebuilds from this hue
   *  (same ladder the dither/phosphor filters use) */
  inkColor: string
  /** The dark tube behind the lines as '#rrggbb' */
  paperColor: string
  /** Glow 0..1 — the real halo radiating around the bright lines */
  glow: number
  /** Stillness 0..1 — how stationary the lines hold around the picture's
   *  focal features (faces, bright shapes): their drift and music ripple
   *  fade out there, so the contour anchors the subject while the rest of
   *  the field keeps moving */
  stillness: number
  /** Wave spread 0..1 — how much wider the waves swing through the
   *  negative space beyond the focal features, out past the image's edges
   *  (the still-to-wild transition widens with the dial too) */
  waveSpread: number
  /** Strength 0..1 — how much of the frame the contour print takes over
   *  (below 1 the untouched frame fades back through) */
  strength: number
  /** React to beat — the whole field swells on the song's low end */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
}

/**
 * Glitch filter — digital corruption: short bursts of chunky pixel blocks
 * (some pixelated in place, some copied from the wrong spot, some tinted
 * with raw palette colors), picture slices shoved sideways and raw saturated
 * color bars stamped over the frame. `rate` is the burst cadence — its own
 * dial, so intensity (blocks/slices) never has to be traded for frequency.
 * Everything is hashed from song time (no Math.random / Date.now), so
 * exports stay frame-exact. Skipped on transparent backgrounds.
 */
export interface GlitchFilterConfig {
  enabled: boolean
  /** Corrupted macroblocks 0..1 (count + size + tint strength) */
  blocks: number
  /** Broken-signal stripes 0..1 (displaced slices + raw color bars) */
  slices: number
  /** Burst cadence 0..1 — how often corruption fires and how long bursts
   *  last; independent of the blocks/slices intensity */
  rate: number
  /** React to beat — every kick forces a burst and punches the corruption
   *  harder; between beats the picture plays exactly as dialed in. The
   *  ambient schedule (`rate`) still runs underneath the beat hits. */
  beatReactive: boolean
  /** How hard the beat punch hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
  /** RANDOMIZE — Slices and Burst rate stop being fixed settings and wander
   *  in a seeded random walk: every Step time each value jumps a random
   *  distance between the Min and Max step dials in a random direction,
   *  lands there, and starts its next jump from there; hitting 0% or 100%
   *  forces the next TWO jumps back toward the dial (the walk's home) so
   *  the walk can never get stuck at an edge. Blocks stays dialed. Moving
   *  a dial re-anchors its walk. The walks are pure functions of the song
   *  clock with fixed dice seeds — the live preview, the MP4 export and
   *  the PNG sequence walk the exact same chaos, second for second. */
  randomize: boolean
  /** Smallest jump per walk step, 0.01..0.5 (default 0.03 = 3%) */
  randomStepMin: number
  /** Largest jump per walk step, 0.01..0.5 (default 0.2 = 20%) */
  randomStepMax: number
  /** Seconds between walk steps, 0.1..3 (default 1) */
  randomStepTime: number
}

/**
 * Anaglyph filter — the old-school paper 3D-glasses look: the finished
 * picture is re-projected once per tint, the base copies shifted
 * horizontally so the whole frame wears classic color fringes.
 * `reactivity` lets the song's low end push the copies apart on beats
 * (frame.bass is part of the deterministic AudioFrame both pipelines
 * produce, so exports pop identically). Each side carries 1–4 tint
 * colors, ordered base → outward: tint 1 is the base lens that
 * recomposes the picture, and every extra tint is a tracer echo one
 * separation-step further out (never averaged into the base).
 * `beatFlip` mirrors the whole stack on every kick (same ONSET detector
 * as Halftone's Flip on kick, listening to the clean sub channel): every
 * copy snaps to the opposite side, holds, then swings back home through
 * offset 0 — where the two lenses recompose the clean full-color picture.
 * `depthPop` collapses the separation to 0% on the same kicks (every copy
 * lands on the center line and the picture recomposes clean and flat),
 * holds, then blooms back out to the dialed-in depth.
 * Skipped on transparent backgrounds like the other full-frame filters.
 */
export interface AnaglyphFilterConfig {
  enabled: boolean
  /** Parallax separation 0..2.5 — how far the left/right copies drift
   *  apart (1 = the classic paper-glasses amount, >1 = wider pop) */
  depth: number
  /** Beat reactivity 0..1 — how much the low end pushes the copies wider
   *  (only active when beatReactive is on) */
  reactivity: number
  /** React to beat — gates the low-end push: off = a fixed, steady
   *  separation; on = the 3D pops on every kick and rests in between */
  beatReactive: boolean
  /** Flip on kick — on a solid low-end hit the whole stereo stack mirrors:
   *  every copy jumps to the opposite side (like turning the paper glasses
   *  around), holds for the flip-hold time, then swings back through the
   *  clean recomposed picture to rest. Uses the same kick detector as the
   *  halftone print's flip. Old saves without this field load as off. */
  beatFlip: boolean
  /** Flip on kick sensitivity 0..1 — how sharp a low-end hit must land
   *  before the flip fires (same clean sub-band onset detector as the
   *  halftone print). Factory default 0.1 sits near the "slams only" end
   *  so ordinary bass motion never flips the glasses. Old saves without
   *  this field load as 0.1. */
  flipSensitivity: number
  /** Flip on kick hold 0..1 — how long the stack stays fully mirrored
   *  after a fired kick (0 = one quick flash, 1 = 2 s) before the 0.25 s
   *  swing back. Factory default 0.2 (0.4 s on the dial) holds the mirror
   *  about a beat. Old saves without this field load as 0.2. */
  flipHold: number
  /** Which side of the swap a fired kick reveals: 'around' mirrors the
   *  whole stereo stack (the glasses turn around — the shipped flip),
   *  'picture' lifts the glasses clean off so the untouched picture
   *  flashes through and settles back, 'print' rests as the untouched
   *  picture and stamps the glasses in on the kick, then fades them
   *  back out. Only matters while beatFlip is on. Old saves without
   *  this field load as 'around'. */
  beatFlipTo: 'around' | 'picture' | 'print'
  /** Depth pop on kick — on a solid low-end hit the separation snaps to
   *  0% (every copy lands on the center line and the lenses recombine
   *  into the clean full-color picture), holds flat for the pop-hold
   *  time, then blooms back out to the dialed-in depth. Same kick
   *  detector as the flip, with its own detector state. Old saves
   *  without this field load as off. */
  depthPop: boolean
  /** Depth pop sensitivity 0..1 — how sharp a low-end hit must land
   *  before the depth pop fires (same clean sub-band onset detector as
   *  the flip and the halftone print). Factory default 0.1 matches the
   *  flip so both fire on the same kicks. Old saves without this field
   *  load as 0.1. */
  popSensitivity: number
  /** Depth pop hold 0..1 — how long the picture stays flat at 0% depth
   *  after a fired kick (0 = one quick flatten-and-bloom, 1 = 2 s)
   *  before blooming back out over the 0.25 s release. Factory default
   *  0.2 (0.4 s on the dial) matches the flip hold. Old saves without
   *  this field load as 0.2. */
  popHold: number
  /** Which perspective the depth separation reads as. 'sides' — every
   *  copy of the whole picture drifts uniformly left/right at ONE depth
   *  (the classic paper-glasses window into the scene, the shipped look).
   *  'foreground' — Pop-out 3D: not a horizontal separation at all — a
   *  saliency mask read off the picture (bright OR high-contrast,
   *  center-weighted shapes) lifts the subject's light off the frame as
   *  stacked additive trace layers that bloom outward from the screen
   *  center, each scaled a step further toward the camera and a step
   *  fainter — a smeared light-trail floating in front of the picture
   *  while the picture itself stays sharp and unmoved. The layers cycle
   *  through both lenses' merged tint palette. Beat pop, Flip on kick and
   *  Depth pop all keep working in both modes (a flipped kick turns the
   *  trace stage inside-out; depth pop flattens the traces). Old saves
   *  without this field load as 'sides'. */
  depthMode: 'sides' | 'foreground'
  /** Blend 0..1 — full anaglyph (1) vs mixed back toward the original (0) */
  strength: number
  /** Left-lens tint colors (1–4), ordered base → outward: tint 1 is the
   *  base layer, extra tints trail one separation-step further out each.
   *  Absent in old saves → classic red. */
  leftColors?: string[]
  /** Right-lens tint colors (1–4), stacked the same way. Absent in old
   *  saves → classic cyan. */
  rightColors?: string[]
}

/**
 * Neon Split filter — the effect.app "neon split" preset, rebuilt from the
 * preset's own published definition and effect shaders (fetched off the site
 * and decrypted — nothing measured/eyeballed). The whole picture runs through
 * the preset's exact chain: a masked inversion across the upper part of the
 * frame (the real "split" — full invert from the top edge, fade centered
 * ~45% down, gone by ~55%: the engine's own mask frame, measured off its
 * render of a luminance-ramp test image), the preset's bloom (6-level mip pyramid, screen blend in
 * linear light — threshold / knee / intensity / mix all dialable), its
 * film-grain noise (colored speckle in linear light — strength, speed, size,
 * chroma and shadow/highlight weighting all dialable), its 4-stop gradient
 * map (#000000 → #002266 → #D55FEC → #FFD6FA) that carries all of the color
 * (with an amount dial), and the master curve. There is no overlay veil
 * anywhere — the color IS the gradient map. The preset's two paper-texture
 * layers are deliberately NOT here (removed by design choice — they added
 * nothing to the look).
 *
 * Deterministic like every full-frame filter (hash-based grain, fixed
 * pipeline). Skipped on transparent backgrounds (alpha must stay clean).
 */
/** One editable stop of the Neon Split gradient map — position 0..1 on the
 *  luminance axis and an sRGB hex color (same shape as the preset ramps). */
export interface NeonMapStop {
  t: number
  c: string
}

export interface NeonSplitFilterConfig {
  enabled: boolean
  /** Which neon ramp the luminance maps onto. 'violet' is the published
   *  preset's own gradient (verbatim stops #000000/#002266/#D55FEC/#FFD6FA at
   *  0/0.406/0.857/1); the others recolor the exact same stop geometry.
   *  Old saves without this field load as 'violet'. */
  ramp: 'violet' | 'uv' | 'acid' | 'ember' | 'ice'
  /** Master-curve depth 0..1 — 0.5 = the preset's own curve (neutral); lower
   *  relaxes the tone curve toward identity (washed), 0..1 clamps at the
   *  preset. */
  contrast: number
  /** Film grain 0..1 — the preset's noise layer strength (exp2-dialed like
   *  the real thing: 0.5 = the published 1.78; the speckle is colored
   *  (chroma 0.69), heavier in highlights than shadows). */
  grain: number
  /** Grain speed 0..1 — how fast the film grain churns. 0 = the published
   *  preset's still grain (the speckle field is pinned); higher values re-roll
   *  the grain field like film — 0.5 ≈ 12 steps/s, 1 = 24 steps/s. Absent in
   *  old saves → 0.5. Deterministic: derived from song time, so exports
   *  match the preview frame for frame. */
  grainSpeed?: number
  /** Neon bloom 0..1 — the preset's bloom intensity (0.5 = the published 3.0). */
  glow: number
  /** Bloom threshold dial 0..1 — how bright a pixel must be before it blooms
   *  (0.5 = the published 0.1; lower blooms more of the picture, higher keeps
   *  the glow to the brightest highlights, range 0..0.8). Absent in old
   *  saves → 0.5. */
  bloomThreshold?: number
  /** Bloom softness dial 0..1 — the soft-knee width of the bright pass (0.5 =
   *  the published 0.29; lower = a harder cutoff, higher = a wider, softer
   *  ramp). Absent in old saves → 0.5. */
  bloomSoftness?: number
  /** Bloom mix dial 0..1 — how much of the glow pyramid screens back over the
   *  picture (0.5 = the published factor 0.65, range 0..1.3). Absent in old
   *  saves → 0.5. */
  bloomMix?: number
  /** Gradient map amount 0..1 — how fully every pixel's color is replaced by
   *  its ramp position (1 = the published full map, the color IS the ramp;
   *  lower blends the original colors back through it). Absent in old saves
   *  → 1. Shown in the UI as the map's Opacity (effect.app's own label). */
  mapAmount?: number
  /** The gradient map's EDITABLE stops — the real gradient-map feature: drag
   *  stops, recolor them, add and remove them. Absent in old saves → derived
   *  from `ramp`. The preset chips write this field (they load their stops
   *  into the editor), so after the first edit this is the source of truth. */
  mapStops?: NeonMapStop[]
  /** Gradient shift −1..1 — slides the ramp window along the luminance axis
   *  (effect.app's Gradient shift; the published preset is 0). Wrapped: colors
   *  that slide off one end re-enter from the other, so shadows can pick up
   *  the ramp's bright end. Absent in old saves → 0. */
  mapShift?: number
  /** Gradient repeat 1..8 — how many times the ramp tiles across the
   *  luminance range (effect.app's Gradient repeat; the published preset is
   *  1). Absent in old saves → 1. */
  mapRepeat?: number
  /** Gradient map blend mode — how the mapped color lands on each pixel
   *  (effect.app's Blend dropdown). Absent in old saves → 'normal'. */
  mapBlend?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'add'
  /** Film grain size dial 0..1 — the noise cell size in px (0.5 = the
   *  published 0.5px fine speckle; higher = chunkier grain, range 0.5..4).
   *  Absent in old saves → 0.5. */
  grainSize?: number
  /** Grain color (chroma) 0..1 — mono ↔ colored speckle (0.69 = the published
   *  chroma; 0 = pure monochrome grain, 1 = fully per-channel). Absent in old
   *  saves → 0.69. */
  grainChroma?: number
  /** Shadow grain dial 0..1 — how much grain sits in the dark tones (0.5 =
   *  the published shadow weight 0.25). Absent in old saves → 0.5. */
  grainShadow?: number
  /** Highlight grain dial 0..1 — how much grain sits in the bright tones
   *  (0.5 = the published highlight weight 0.53). Absent in old saves → 0.5. */
  grainHighlight?: number
  /** The split 0..1 — how much of the frame, measured from the BOTTOM, fades
   *  back to the untouched picture. 0 = the whole frame goes neon (the
   *  published preset); 0.4 = the bottom 40% keeps its own colors, the rest is
   *  neon, with a soft edge between. */
  split: number
  /** Mix 0..1 — the full neon look blended back over the untouched picture
   *  (1 = the grade replaces the frame, lower values dial it back). */
  strength: number
}

/**
 * Color grade filter — the classic tone grades over the whole finished
 * picture: Black & white (luminance mono with a contrast dial) and Sepia
 * (the warm brown archive print, contrast + warmth dials). Runs as the
 * color stage of the filter chain, directly after Neon Split — it tones
 * whatever is beneath it, so the two can stack.
 *
 * Deterministic per-pixel math like every full-frame filter. Skipped on
 * transparent backgrounds (alpha must stay clean).
 */
export interface ColorGradeFilterConfig {
  enabled: boolean
  /** Which grade: 'bw' = black & white, 'sepia' = the warm archive tone. */
  look: 'bw' | 'sepia'
  /** Strength 0..1 — the grade blended back over the original colors. */
  strength: number
  /** Contrast dial 0..1 — tone curve depth around mid-gray (0.5 = neutral,
   *  lower washes toward flat, higher = punchier). */
  contrast: number
  /** Sepia warmth 0..1 — how deeply the brown tint sits in (0.5 = the
   *  classic sepia matrix; lower heads back toward plain mono, higher
   *  deepens the amber). Absent in old saves → 0.5. Sepia only. */
  warmth?: number
}

/**
 * Gradient map — effect.app's Gradient Map effect as its own Color-tab
 * stage: every pixel's Rec.709 luminance re-reads as a position on a
 * gradient ramp and the mapped color lands on the pixel through a blend
 * mode at an opacity — the same engine node the Neon Split preset runs
 * (identical per-channel math, ported from the site's decrypted
 * gradient-map shader), rebuilt here as a standalone fully dialable pass
 * with its own preset ramp library and a shift window that can cycle on
 * its own (continuous) or advance on every detected kick (beat).
 *
 * Deterministic per-pixel math like every full-frame filter: the window
 * position derives from the AudioFrame clocks (styleTime for continuous,
 * song time through the shared flipGate detector for beat), so exports
 * match the preview. Skipped on transparent backgrounds.
 */
export interface GradientMapFilterConfig {
  enabled: boolean
  /** Which built-in ramp the luminance maps onto. 'neon' is the house
   *  look (the Neon Split preset's own gradient, verbatim stops); the
   *  others span the classic duotone/thermal families; 'custom' reads
   *  the user's own editable stops (customStops below). Absent in old
   *  saves → 'neon'. */
  preset: GradientMapPresetId
  /** The CUSTOM ramp's editable stops ({ t: 0..1, c: '#rrggbb' }, any
   *  order — the LUT sorts internally). Only read when preset is
   *  'custom'; 2..8 stops, garbage falls back to the house ramp. Seeded
   *  with the Neon stops so Custom starts as the house look, editable.
   *  Absent in old saves → the seed stops. */
  customStops: { t: number; c: string }[]
  /** Blend mode — how the mapped color lands on each pixel (effect.app's
   *  Blend dropdown, the map node's five modes with the exact per-channel
   *  math the shader runs). Absent in old saves → 'normal'. */
  blend: 'normal' | 'multiply' | 'screen' | 'overlay' | 'add'
  /** Opacity 0..1 — how much of the blended map color lands on the pixel
   *  (1 = the full map; 0 = the untouched picture). Absent in old saves
   *  → 1. */
  opacity: number
  /** Gradient shift −1..1 — slides the ramp window along the luminance
   *  axis (effect.app's Gradient shift; wrapped: colors that slide off
   *  one end re-enter from the other). The motion modes below ADD to
   *  this dial. Absent in old saves → 0. */
  shift: number
  /** Gradient repeat 1..8 — how many times the ramp tiles across the
   *  luminance range (effect.app's Gradient repeat). Absent in old
   *  saves → 1. */
  repeat: number
  /** Shift motion: 'manual' = the dial only (the still default);
   *  'continuous' = the window auto-cycles along the ramp on the style
   *  clock; 'beat' = every detected kick (the shared flipGate sub-band
   *  onset detector) advances the window one step with a short glide;
   *  'random' = a random walk — the window starts at 0% and every step
   *  time it jumps a random 3–20% (min/max dials) in either direction,
   *  landing there and starting the next jump from there; hitting
   *  ±100% forces the next TWO jumps back toward 0% so the walk can't
   *  pile up at the edges. Absent in old saves → 'manual'. */
  shiftMode: 'manual' | 'continuous' | 'beat' | 'random'
  /** Continuous speed 0..1 — how fast the window cycles (1 = a full
   *  sweep of the ramp every 2 seconds). Continuous mode only. Absent
   *  in old saves → 0.3. */
  shiftSpeed: number
  /** Beat step 0.05..1 — how far each detected kick advances the window
   *  (0.25 = a quarter of the ramp per kick). Beat mode only. Absent
   *  in old saves → 0.25. */
  beatStep: number
  /** Beat direction — which way each kick walks the window: 'forward'
   *  climbs the ramp per kick (the shipped behavior), 'backward' walks
   *  down it, 'bounce' ping-pongs (forward a full sweep, then back).
   *  Beat mode only. Absent in old saves → 'forward'. */
  beatDir: 'forward' | 'backward' | 'bounce'
  /** Kick sensitivity 0..1 for the beat mode's detector (the flipGate
   *  sens dial, same one the halftone/3D-glasses/halation flips expose):
   *  lower = only the hardest slams fire a step, higher = every tap.
   *  Beat mode only. Absent in old saves → 0.12 (the value this pass
   *  shipped with hardcoded, so old saves behave identically). */
  beatSens: number
  /** Glide 0.02..0.6 s — how long each kick's step takes to ease in
   *  (short = snappy strobe cuts, long = smooth rolls). Beat mode only.
   *  Absent in old saves → 0.14 (the hardcoded shipped ease). */
  beatEase: number
  /** Random-walk mode — smallest jump per iteration, 0.01..0.5 of the
   *  ramp. Randomize mode only. Absent in old saves → 0.03 (the
   *  requested 3% floor). */
  randomStepMin: number
  /** Random-walk mode — largest jump per iteration, 0.01..0.5 of the
   *  ramp (each jump draws uniformly between the min and max dials;
   *  swapped dials are swapped back). Randomize mode only. Absent in
   *  old saves → 0.2 (the requested 20% ceiling). */
  randomStepMax: number
  /** Random-walk mode — seconds per iteration: how long the window
   *  rests at each landed position before the next jump (each jump
   *  eases in over 150 ms). Randomize mode only. Absent in old saves
   *  → 0.5. */
  randomStepTime: number
}

/** The built-in gradient-map ramp library (see gradient-map-filter.ts for
 *  the stop data). 'neon' is the Neon Split preset's own ramp. */
export type GradientMapPresetId =
  | 'neon'
  | 'uv'
  | 'acid'
  | 'ember'
  | 'ice'
  | 'sunset'
  | 'magma'
  | 'gold'
  | 'rose'
  | 'mono'
  | 'custom'

/**
 * Halation filter — the classic film optical artifact over the whole
 * finished picture: bright highlights bleed a glowing halo into the
 * frame around them, exactly the way light blooms through film into the
 * film base and reflects back (the look Kodak stocks are famous for —
 * in whatever halo color the tint below picks).
 *
 * Rebuilt from effect.app's own Halation effect — the four encrypted GLSL
 * passes (bright pass / horizontal diffusion / vertical diffusion / halo
 * composite) were fetched off the site and decrypted verbatim; every dial
 * below is the shader's own uniform at the shader's published default.
 * Spectra extensions on top: the shader's hardcoded red→orange tint pair
 * is generalized to any picked color, an opt-in beat flare pushes both
 * the bright-pass energy AND the finished halo with the song's low end,
 * and an opt-in Flip on kick swaps the whole look per detected kick —
 * the same flipGate detector the halftone print and the 3D glasses
 * share, with the same Around / The picture / The print directions
 * translated to what a halo is made of (color / the untouched frame).
 *
 * The chain, exactly as the site runs it:
 *   1. Bright pass — the frame's Rec.709 luminance (in linear light) goes
 *      through a soft-knee threshold; what survives is scaled by
 *      0.4 + boost · 1.8 into the glow energy channel.
 *   2./3. Diffusion — the energy blurs horizontally then vertically at TWO
 *      radii (a fraction of the frame width): a tight "local" glow and a
 *      wide "global" halo. The blur is a capped 80-tap sweep with
 *      quadratic-smoothed linear weights (the exact window the site's
 *      shader runs).
 *   4. Composite — the tight glow tints toward a half-white-hot version of
 *      the picked halo color the hotter it burns (the heat mix rises with
 *      boost), the wide halo stays the picked color at half strength;
 *      everything screens back over the original in linear light. A
 *      background gate (dark-only ↔ everywhere) decides what tonal range
 *      can catch the halo, and a blue damper keeps skies/cool pixels from
 *      blushing.
 *
 * React to beat (opt-in, default off) — two flares ride the same Beat
 * flare dial through the shared beatBoost helper while the song's low
 * end (frame.bass) hits: the bright-pass energy multiplies up to
 * strength × 1.6 (the fringe grows into the glow) and the FINISHED halo
 * in the composite multiplies up to strength × 2 (the visible glow —
 * hot core included — blooms brighter per kick, which is where the
 * reaction reads). Both rest at exactly 1 between kicks so the
 * dialed-in look is untouched while the song is quiet.
 *
 * Flip on kick (opt-in, default off) — on a bass ONSET on the clean
 * sub-band channel (the shared flipGate detector, per-filter state) the
 * whole look swaps for the Flip hold time, then falls back over a short
 * release, in the direction beatFlipTo chooses: 'around' swings the tint
 * to its linear-light complement (the halo changes color, holds, swings
 * back — byte-identical to flip off at rest); 'picture' rests the halo
 * on the frame and on a kick lifts it clean off so the untouched picture
 * flashes through; 'print' rests as the untouched picture and stamps the
 * halation in on the kick. Deterministic (same frame in, same pixels
 * out); skipped on transparent backgrounds like every full-frame filter.
 */
export interface HalationFilterConfig {
  enabled: boolean
  /** Bright-pass threshold 0..1 — how bright a pixel's luminance (in
   *  linear light) must be before it starts to halo (published 0.6). */
  threshold: number
  /** Knee (softness of the threshold edge) 0.01..0.8 — higher eases more
   *  mid-tones into the glow (published 0.25). */
  knee: number
  /** Boost 0..1 — extra energy pushed through the bright pass (published
   *  0.5); also feeds the glow's shift from red toward orange. */
  boost: number
  /** Local diffusion 0.005..0.2 — the tight glow radius as a fraction of
   *  the frame width (published 0.04). */
  localDiffusion: number
  /** Global diffusion 0..0.4 — the wide halo radius as a fraction of the
   *  frame width (published 0.12). */
  globalDiffusion: number
  /** Intensity 0..1 — how strongly the halo lands on the frame (published
   *  0.7). */
  intensity: number
  /** The halo color, a CSS hex string ("#rrggbb") — the picker or a preset.
   *  The hottest core of the glow drifts toward a half-white-hot version of
   *  it; absent in old saves → the Kodak default "#ff4d21". */
  tint: string
  /** Beat flare switch — when on, the glow energy AND the finished halo
   *  multiply while the song's low end hits and rest at the dialed-in
   *  look between kicks. */
  beatReactive: boolean
  /** How hard the beat flare hits, 0..1 (only matters when beatReactive) */
  beatStrength: number
  /** Flip on kick switch — on a solid low-end hit the whole look swaps
   *  for the hold time, then falls back (the 3D glasses flip, with its
   *  same detector and dials). */
  beatFlip: boolean
  /** Which side of the swap the kick reveals — 'around' flips the tint
   *  to its complement, 'picture' flashes the untouched frame through,
   *  'print' rests clean and stamps the halation in on the kick. */
  beatFlipTo: 'around' | 'picture' | 'print'
  /** Kick detector sensitivity 0..1 — lower = only the hardest slams
   *  fire the flip, higher = every tap (only matters when beatFlip). */
  flipSensitivity: number
  /** Flip hold 0..1 — how long the swapped look stays fully swapped
   *  before the quick 0.25s fall-back (only matters when beatFlip). */
  flipHold: number
  /** Background gain 0..1 — where the halo may land: 0 = over dark tones
   *  only, 1 = over the whole frame (published 0.85). */
  backgroundGain: number
  /** Compensation 0..1 — tames the halo over blue pixels (skies, cool
   *  stages); 1 never damps, 0 kills the halo on any blue-leaning tone
   *  (published 0.5). */
  blueComp: number
}

/**
 * Exposure filter — effect.app's "Instant Film" effect over the whole
 * finished picture (renamed Exposure in Spectra): the frame is graded
 * through a real instant-film stock LUT (Polaroid 600/669/690 and expired
 * cousins, Instax Mini, Fuji FP-100C in warm/cool/expired) — the site's
 * own 33³ LUT data and its own shader math, ported byte-faithfully and
 * verified against the live editor to the exact byte.
 *
 * The shader grades by trilinear-sampling the stock's 33³ sRGB LUT, then
 * mixes the graded color over the original in Oklab — LIGHTNESS by the
 * Light dial, CHROMA (a/b) by the Color dial — and converts back to sRGB.
 * Both dials run 0..2: 1 is the published look, 0 leaves the picture
 * untouched, 2 pushes past the stock. The whole pipeline is precomputed
 * once per (stock, Color, Light) into a 65³ expansion grid (four times
 * denser than the site's own LUT) so the per-frame cost is one trilinear
 * lookup per pixel; the stock strips themselves are the site's decoded
 * LUT texels shipped as lazily-fetched PNGs. Runs as the color stage of
 * the filter chain, directly after the color grade and before the
 * halation glow (so the glow lands on the film-graded tones). Skipped on
 * transparent backgrounds (alpha must stay clean) like every full-frame
 * filter; while a stock's LUT strip is still downloading the pass lets
 * the frame through untouched.
 */
export type ExposureStockId =
  | 'polaroid-600'
  | 'polaroid-600-golden'
  | 'polaroid-600-expired'
  | 'polaroid-669'
  | 'polaroid-669-expired'
  | 'polaroid-690'
  | 'polaroid-690-expired'
  | 'instax-mini'
  | 'instax-mini-deep'
  | 'fp100c'
  | 'fp100c-warm'
  | 'fp100c-cool'
  | 'fp100c-expired'

export interface ExposureFilterConfig {
  enabled: boolean
  /** Which instant-film stock's LUT grades the picture (the site's Type
   *  selector — its factory default, 'polaroid-600', is first). Absent in
   *  old saves → 'polaroid-600'. */
  stock: ExposureStockId
  /** Color amount 0..2 — how much of the graded color's CHROMA (Oklab a/b)
   *  lands on the picture (the site's Amount X; 1 = the published look).
   *  Absent in old saves → 1. */
  color: number
  /** Light amount 0..2 — how much of the graded color's LIGHTNESS (Oklab L)
   *  lands on the picture (the site's Amount Y; 1 = the published look).
   *  Absent in old saves → 1. */
  light: number
}

/** The materials the Texture filter can print the picture onto — the
 *  eight procedural surfaces plus 'custom', the user's own uploaded
 *  texture image (its luminance IS the height field). 'grain' is the only
 *  procedural one that animates (film-grain flicker at 24 fps); the rest
 *  are static physical surfaces. */
export type TextureFilterType =
  | 'grain'
  | 'paper'
  | 'canvas'
  | 'concrete'
  | 'glass'
  | 'foil'
  | 'rust'
  | 'dirt'
  | 'custom'

/**
 * Texture filter — the finished picture printed onto a physical material
 * (the user's ask: "a section called texture where we can add different
 * textures, i think its called displacement, where we can see the flaws and
 * texture through the image"). Every material is a procedural surface with
 * a HEIGHT field: the height's slope DISPLACES the picture (pixels sample
 * around their neighbors, so the surface's flaws warp the image — the
 * literal displacement mapping), shades it like a lit relief (light from
 * the upper left) and blends the material's own tone over it. `amount` is
 * the master dial — 0 = the untouched picture, 1 = the full printed look —
 * and scales displacement, shading and albedo together, so the material
 * always fades in as ONE coherent surface. `scale` sizes the material's
 * features (fibers, pits, wrinkles) relative to the frame, resolution-
 * independent (720p reference). Deterministic: the fields come from integer
 * lattice hashing (same config → same texture every frame, preview and
 * export agree frame-exactly; grain re-picks its noise tile on the 24 fps
 * film-frame clock, the same cadence the Film filter's dust runs on).
 * Skipped on transparent backgrounds like every full-frame filter, so
 * alpha recordings stay clean.
 */
export interface TextureFilterConfig {
  enabled: boolean
  /** Which material prints the picture. Old saves without this field
   *  load as 'paper' (the most legible displacement demo). */
  type: TextureFilterType
  /** Texture strength 0..1 — how hard the material's surface warps the
   *  picture (the displacement, with the mean-zero relief shading riding
   *  along). The image's own colors never darken, lighten or tint — the
   *  texture BENDS it, it doesn't tint it. */
  amount: number
  /** Texture scale 0.4..3 — the material's feature size relative to the
   *  frame (lower = finer grain, higher = bigger wrinkles/pits). Unused
   *  by 'custom', which has its own Size dial. */
  scale: number
  /** The user's own texture image (data URL) — 'custom' lights the
   *  picture with THIS image: its brighter parts add a small highlight,
   *  its darker parts add a small shadow (no warping, no tinting). Empty
   *  in old saves and until the user uploads one. */
  customSrc: string
  /** Custom texture zoom 0.2..4 — 1 = one tile cover-fits the frame
   *  (resolution-independent); bigger = bigger light/shadow shapes,
   *  smaller = finer ones. */
  customSize: number
  /** Custom texture nudge, a fraction of the frame (-1..1 both axes) —
   *  Move X slides it sideways, Move Y vertically. The image tiles, so
   *  nudging never runs out of texture. */
  customX: number
  customY: number
  /** Custom texture rotation in degrees (-180..180), pivoting on the
   *  (moved) frame center. */
  customRotate: number
  /** Custom texture contrast 0..2 (100 = the linear response): shapes the
   *  lighting response CURVE around the map's own average — how selective
   *  the lighting is. Higher stretches the deviations so more of the
   *  map's mid-tones light up (wider, punchier spread); lower pulls them
   *  toward zero so only the strongest bright/dark features light; 0 = a
   *  perfectly flat sheet (no highlight, no shadow at all). It moves the
   *  SHAPE of the response, not its amplitude — Amount is the strength
   *  dial, so the two do different jobs. */
  customContrast: number
  /** Custom texture highlight strength 0..2 (100 = neutral): a separate
   *  multiplier on the WHITE half of the lighting pass. On an
   *  overall-light upload the user drops this instead of killing the
   *  whole pass — the shadows keep sculpting while the white stops
   *  overpowering the picture. 0 = the pass adds no light anywhere. */
  customHighlights: number
  /** Custom texture highlight color, #rrggbb (default white): the light
   *  the pass blends toward on the map's bright parts — warm tungsten,
   *  cool daylight, any tint. White keeps the pass neutral. */
  customHighlightColor: string
  /** Custom texture shadow strength 0..2 (100 = neutral): the same
   *  separate multiplier on the BLACK half of the lighting pass — the
   *  darks can be deepened or erased independently of the highlights.
   *  0 = the pass adds no shadow anywhere. */
  customShadows: number
  /** Custom texture shadow color, #rrggbb (default black): the tone the
   *  pass sinks toward on the map's dark parts — blue night shade, sepia
   *  grime, any tint. Black keeps the pass neutral. */
  customShadowColor: string
  /** Custom texture WARP — off by default (the lighting pass keeps the
   *  picture pixel-crisp). On, the map's bright/dark CONTOURS also
   *  displace the picture: bright areas bulge it outward like a raised
   *  bump, dark areas dent it inward, sampled smoothly so no per-texel
   *  noise or blocks — the optional physical-surface read on top of the
   *  lighting. */
  customWarp: boolean
  /** Custom texture warp strength 0..1 — how far the contours drag the
   *  picture at their steepest (0 = no warp even with the switch on;
   *  1 = a full material-grade bend). Rides the Amount master dial. */
  customWarpStrength: number
}

/**
 * Polaroid filter — the wall of instant prints: the whole page becomes a
 * scattered field of white-frame polaroid cards (the classic 88×107 mm
 * print with its 79 mm square photo window and chunky chin), and inside
 * every card's square photo section the FULL finished picture shows
 * through — a wall of live prints of the music video. Grid split (the
 * effect.app look) cuts each square into sections that drift and shuffle
 * INSIDE the frame on the beat. An optional polaroid-specific photo
 * upload prints the user's own image on every card instead of the
 * picture. Deterministic: the print layout comes from an integer-seeded
 * PRNG (same config + canvas size → the exact same wall every frame, in
 * the preview and in exports) and all motion runs off the AudioFrame
 * clocks, so nothing flickers or reshuffles between frames. Skipped on
 * transparent backgrounds like the other full-frame filters.
 */
export interface PolaroidFilterConfig {
  enabled: boolean
  /** Print density 0..1 — 0 = a few big prints, 1 = a packed wall of
   *  small ones (capped so phones stay smooth). */
  density: number
  /** Scatter 0..1 — how far the prints tilt and wander off their grid
   *  slots (0 = a neat aligned grid, 1 = the messy overlapping pile). */
  scatter: number
  /** Backdrop behind the wall: 'paper' = the studio-table light look
   *  (the reference image), 'charcoal' = a dark room so the white cards
   *  pop, 'color' = any color the user picks (backdropColor), 'image' =
   *  the wall image (or the polaroid photo) cover-fit behind the cards
   *  as the background layer. Old saves without this field load as
   *  'paper'. */
  backdrop: 'paper' | 'charcoal' | 'image' | 'color'
  /** Custom table color as '#rrggbb' for the 'color' backdrop — the room
   *  the prints sit in, and the tone that shows when the wall image
   *  slides past its own edge. Old saves → '#2e2e35'. */
  backdropColor?: string
  /** Grid split — the effect.app look: each photo window shows the
   *  picture split into sections that drift (and jump on kicks) inside
   *  the frame. Old saves without this field load as off. */
  gridSplit: boolean
  /** Split drift 0..1 — how far the sections wander and how hard they
   *  jump on a kick (only matters while gridSplit is on). Old saves → 0.5. */
  splitAmount: number
  /** React to beat — the prints pulse on the song's low end and the
   *  split sections jump on detected kicks. Old saves → off. */
  beatReactive: boolean
  /** Beat punch 0..1 — how hard the pulse and the kick jumps land. */
  beatStrength: number
  /** What shows through every photo window: 'video' = the finished
   *  picture (the default wall of live prints), 'photo' = the uploaded
   *  polaroid photo printed on every card, 'mosaic' = ONE uploaded image
   *  spread across the whole wall — every card reveals the piece of it
   *  at that card's own spot (no two cards alike) and the image doubles
   *  as the background layer behind the cards. Old saves → 'video'. */
  photoMode: 'video' | 'photo' | 'mosaic'
  /** The polaroid-specific uploaded photo (data URL) printed on every
   *  card while photoMode is 'photo'. Travels inside saved projects;
   *  stripped from share links like every other image pixel. Old saves
   *  → ''. */
  photoSrc?: string
  /** The ONE wall image (data URL) for photoMode 'mosaic': it cover-fits
   *  the whole page, every card's window reveals the piece of it under
   *  that card, and with the 'image' backdrop it doubles as the background
   *  layer behind the wall. Travels inside saved projects; stripped from
   *  share links like every other image pixel. Old saves → ''. */
  mosaicSrc?: string
  /** Photo zoom 0.6..2.2 — the cover-crop amount for the uploaded photo
   *  (1 = framed by the photo's own edges, higher punches in). Old saves → 1. */
  photoZoom?: number
  /** Wall image zoom 0.6..2.2 — the cover-crop amount for the ONE image
   *  spread across the wall in photoMode 'mosaic' (1 = framed by the
   *  image's own edges, higher punches in). Scales the background layer
   *  and the piece every card reveals together, so the wall stays glued
   *  to its backdrop. Old saves → 1. */
  mosaicZoom?: number
  /** Wall image pan X/Y −1..1 — slides the ONE image across the frame at
   *  its true size (0 = centered, ±100% = a quarter of the frame when the
   *  cover fit leaves no overflow — the scale NEVER reacts to the pan, so
   *  past the image's own edge the bare table tone shows; more Image size
   *  = more sliding room). Moves the background layer and the piece every
   *  card reveals together, so the wall stays glued to its backdrop. Old
   *  saves → 0. */
  mosaicPanX?: number
  mosaicPanY?: number
  /** Wall image rotation −180..180 degrees — spins the ONE image around the
   *  frame center (with the scale auto-grown so the rotated image still
   *  covers the frame at every angle — no flat corners ever show). Old
   *  saves → 0. */
  mosaicRot?: number
  /** Mix 0..1 — 1 = the whole frame becomes the wall of prints, lower
   *  blends the untouched picture back over it. Old saves → 1. */
  strength: number
}

/* -------------------------------- Custom fonts ------------------------------- */

/**
 * An imported font file (usable by the lyrics and the title card). `data` is
 * the file as a base64 data URL — it travels inside saved projects but is
 * stripped from share links (far too big for a URL), exactly like image
 * pixels. Absent/empty `fonts` arrays mean built-in fonts only.
 */
export interface CustomFontConfig {
  /** Stable id ("cf_…") referenced by lyrics.font / title.font */
  id: string
  /** Display name — the imported file name without extension */
  name: string
  /** Font file bytes as a data URL */
  data: string
}

/* ----------------------------------- Project --------------------------------- */

export interface StudioConfig {
  visualizer: VisualizerConfig
  background: BackgroundConfig
  lyrics: LyricsConfig
  title: TitleConfig
  disc: DiscConfig
  pulseImage: PulseImageConfig
  watermark: WatermarkConfig
  /** Full-frame display post-pass (CRT scanlines + phosphor mask + …) */
  screenFilter: ScreenFilterConfig
  /** Full-frame tape post-pass (VHS wobble + tracking + dropouts) */
  vhsFilter: VhsFilterConfig
  /** Full-frame camcorder post-pass (the effect.app Backrooms preset:
   *  analog tape pipeline + baked zone grade + gaussian haze) */
  camcorderFilter: CamcorderFilterConfig
  /** Full-frame film-damage post-pass (scratches + dust + flicker) */
  filmFilter: FilmFilterConfig
  /** Full-frame print post-pass (45° halftone dots on darker tones) */
  halftoneFilter: HalftoneFilterConfig
  /** Full-frame digital-corruption post-pass (bursty glitch artifacts) */
  glitchFilter: GlitchFilterConfig
  /** Full-frame anaglyph post-pass (red/cyan 3D-glasses re-projection) */
  anaglyphFilter: AnaglyphFilterConfig
  /** Full-frame neon post-pass (gradient map + bloom + film grain — the
   *  effect.app "neon split" preset look) */
  neonSplitFilter: NeonSplitFilterConfig
  /** Full-frame color grade (black & white / sepia tone shaping) */
  colorGradeFilter: ColorGradeFilterConfig
  /** Full-frame gradient-map stage (the effect.app Gradient Map effect —
   *  luminance re-read through a gradient ramp, blend/opacity/shift/repeat
   *  dialable, the window cyclable continuously or on kicks) */
  gradientMapFilter: GradientMapFilterConfig
  /** Full-frame halation post-pass (the film highlight-bleed glow — the
   *  effect.app Halation effect) */
  halationFilter: HalationFilterConfig
  /** Full-frame instant-film stock grade (the effect.app "Instant Film"
   *  effect — renamed Exposure in Spectra) */
  exposureFilter: ExposureFilterConfig
  /** Full-frame texture stage (the picture warped onto a physical
   *  material — displacement + mean-zero relief shading, no tone tint) */
  textureFilter: TextureFilterConfig
  /** Full-frame polaroid-wall post-pass (the page becomes scattered instant
   *  prints, the picture showing through every photo window) */
  polaroidFilter: PolaroidFilterConfig
  /** Full-frame retro-dither post-pass (Bayer dot patterns + glow bloom) */
  ditherFilter: DitherFilterConfig
  /** Full-frame phosphor-monitor post-pass (vertical dash columns + bloom) */
  phosphorFilter: PhosphorFilterConfig
  /** Full-frame contour post-pass (glowing woven-thread waveform lines) */
  contourFilter: ContourFilterConfig
  /** Full-frame cubify post-pass (the picture resampled into glossy 3D
   *  cube tiles — the effect.app Cubify effect) */
  cubifyFilter: CubifyFilterConfig
  /** Full-frame kaleidoscope post-pass (radial mirror wedges around a
   *  center point) */
  kaleidoscopeFilter: KaleidoscopeFilterConfig
  /** Full-frame water-wave post-pass (thin-strip sine ripple) */
  waveWarpFilter: WaveWarpFilterConfig
  /** Full-frame vignette post-pass (elliptical lens falloff at the edges) */
  vignetteFilter: VignetteFilterConfig
  /** Full-frame camera-shake post-pass (handheld drift + beat jolt) */
  shakeFilter: ShakeFilterConfig
  /** Full-frame strobe post-pass (random-interval color inversion + beat
   *  flashes, tintable negative) */
  strobeFilter: StrobeFilterConfig
  /** How the moving layers interact with the full-frame filter chain */
  layers: LayersConfig
  /** Imported font library — shared by the lyrics and the title card */
  fonts: CustomFontConfig[]
}

/* ------------------------------ Layers vs filters ----------------------------- */

/**
 * How the moving layers (visualizer, pulse image, vinyl disc, lyrics, title,
 * watermark) interact with the full-frame filter chain.
 */
export interface LayersConfig {
  /** Layers stay colored — the moving layers AND the text overlays render
   *  into their own transparent overlay and are drawn back in full color ON
   *  TOP of the finished filter chain (screen, VHS, film, halftone print,
   *  glitch and 3D glasses), so every filter only ever textures the
   *  background picture and the layers never lose their color. While on,
   *  the layers skip every full-frame filter pass. No-op on transparent
   *  backgrounds (those skip the filters anyway). */
  stayColored: boolean
  /** Text stays legible — the text overlays (lyrics, titles, watermark)
   *  render into their own transparent overlay drawn back ON TOP of the
   *  finished filter chain, so the words never get textured/doubled/torn by
   *  screen, VHS, film, halftone print, glitch or 3D glasses. Unlike
   *  stayColored, the moving layers (visualizer, pulse image, vinyl) still
   *  ride through the filters and take the full look. Only meaningful while
   *  stayColored is off — stayColored already lifts the text (with
   *  everything else) above the chain. No-op on transparent backgrounds. */
  textClear: boolean
  /** Filter alpha — a single transparency dial on top of the ENTIRE filter
   *  chain (screen, VHS, film, halftone print, glitch, 3D glasses). Below
   *  100% the pre-filter frame is snapshotted and drawn back over the
   *  filtered result at (1 − alpha), so 100% is the classic full-strength
   *  look (byte-identical, no extra pass), 0% hides every filter without
   *  touching their switches, and in between the filtered look fades into
   *  the unfiltered frame. No-op on transparent backgrounds. */
  filterAlpha: number
}

/**
 * Resolve the `layers` section for a config arriving from a saved project,
 * project file or share link. New saves carry their own `layers`; old saves
 * (from before the global toggle existed) graduate the halftone's flip-gated
 * "Layers stay colored" — but only where it was actually active (the old
 * renderer ignored it unless the halftone AND its Flip on kick were both on).
 * The raw value is read untyped: the legacy `flipColorLayers` key no longer
 * exists on HalftoneFilterConfig.
 */
export function resolveLayersConfig(saved: unknown): LayersConfig {
  const s = (saved ?? {}) as {
    layers?: { stayColored?: unknown; textClear?: unknown; filterAlpha?: unknown }
    halftoneFilter?: { enabled?: unknown; beatFlip?: unknown; flipColorLayers?: unknown }
  }
  const stayColored =
    typeof s.layers?.stayColored === 'boolean'
      ? s.layers.stayColored
      : !!(s.halftoneFilter?.enabled && s.halftoneFilter.beatFlip && s.halftoneFilter.flipColorLayers)
  const textClear = typeof s.layers?.textClear === 'boolean' ? s.layers.textClear : false
  // Saves from before the alpha dial existed stay at full filter strength;
  // finite values clamp into 0..1, anything else falls back to 1.
  const rawAlpha = s.layers?.filterAlpha
  const filterAlpha =
    typeof rawAlpha === 'number' && Number.isFinite(rawAlpha)
      ? Math.min(1, Math.max(0, rawAlpha))
      : 1
  return { stayColored, textClear, filterAlpha }
}

/* --------------------------------- Audio frame -------------------------------- */

/**
 * Deterministic per-frame audio analysis fed to the renderer.
 * Both the live preview (AnalyserNode) and the offline exporter (own FFT)
 * produce this exact shape, so the same renderer is used everywhere.
 */
export interface AudioFrame {
  /** Song time in seconds */
  time: number
  /**
   * Decorative-motion clock: gradient color cycling, ambient wobble, slow
   * rotation. Free-runs on a wall clock in the live preview (so styling stays
   * alive while paused) and equals `time` in offline/export frames, keeping
   * exported video deterministic.
   */
  styleTime: number
  /** Frequency magnitudes, normalized 0..1, length = barCount */
  freq: Float32Array
  /** Waveform samples, normalized -1..1, length 2048 */
  wave: Float32Array
  /** Overall RMS energy 0..1 */
  energy: number
  /** Bass energy 0..1 (first ~10% of spectrum) */
  bass: number
  /** Treble energy 0..1 (last ~30% of spectrum) */
  treble: number
  /**
   * Clean sub-band energy (≈30–130 Hz RMS of the raw samples — NOT dB-clipped
   * like `bass`). The kick onset detector listens to this: loud masters pin
   * `bass` at its clip ceiling, where a kick moves the number by zero.
   */
  sub: number
}

/* ------------------------------- Renderer API -------------------------------- */

export interface RenderContext {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  /** Frame index (deterministic export uses integer frames) */
  frame: number
  /** Live-preview marker: full-frame filters may adapt internal resolution
   *  for interactivity on slow GPUs. The exporter never sets it, so exported
   *  frames always render at full fidelity. */
  interactive?: boolean
  /** The on-screen footprint of the Image-visualizer artwork, recorded by
   *  drawImageViz each frame (null whenever no artwork is drawn — other
   *  styles, placeholder, still decoding, or the artwork lifted above the
   *  filter chain by "layers stay colored"). Full-frame filters that
   *  represent a physical medium anchor to it: the Camcorder's tape pipeline
   *  runs on this rect so its edge artifacts (effect.app's colored streaks
   *  seeping in from the picture's left/right vertical edges, the bottom
   *  head-switch smear, the top tear) land on the picture's own edges, the
   *  way their engine always renders the effect with the media filling the
   *  frame. `workW`/`workH` carry the artwork's stable, un-animated size so
   *  the pipeline's offscreen buffers never churn with the beat motion. */
  imageVizRect?: {
    x: number
    y: number
    w: number
    h: number
    workW: number
    workH: number
  } | null
}

/** Stateless, pure render call: same inputs → same pixels. */
export type RenderFrameFn = (rc: RenderContext, frame: AudioFrame, config: StudioConfig) => void

/* --------------------------------- Export API --------------------------------- */

/**
 * Deterministic export containers:
 *  - mp4  — H.264 + AAC, the universal upload format (Facebook, Instagram,
 *    TikTok, YouTube, X). When the browser has no AAC encoder the audio is
 *    converted to AAC in-browser (ffmpeg.wasm) before download, so the file
 *    is always accepted by social platforms.
 *  - webm — VP9 + Opus, smaller files for the open web / Discord embeds.
 */
export type ExportFormat = 'mp4' | 'webm'
export type ExportLength = 'full' | '30s' | '15s'
export type ExportResolution = '1280x720' | '1920x1080' | '1080x1080' | '720x1280'

/** Pixel dimensions for every export resolution (single source of truth). */
export const RESOLUTION_DIMS: Record<ExportResolution, { width: number; height: number }> = {
  '1280x720': { width: 1280, height: 720 },
  '1920x1080': { width: 1920, height: 1080 },
  '1080x1080': { width: 1080, height: 1080 },
  '720x1280': { width: 720, height: 1280 },
}

export type Orientation = 'landscape' | 'portrait' | 'square'

/**
 * Shape summary for an export resolution — aspect ratio, orientation name and
 * a human ratio label ("16:9", "1:1", "9:16"). Drives the preview canvas
 * fitting and the orientation outline in the Export tab.
 */
export function resolutionShape(res: ExportResolution): {
  /** width / height (≤1 portrait, 1 square, ≥1 landscape) */
  aspect: number
  orientation: Orientation
  ratioLabel: string
} {
  const { width, height } = RESOLUTION_DIMS[res]
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(width, height)
  const orientation: Orientation =
    width > height ? 'landscape' : width < height ? 'portrait' : 'square'
  return { aspect: width / height, orientation, ratioLabel: `${width / g}:${height / g}` }
}

/**
 * Encoder quality tier. Drives the H.264 target bitrate (bits per pixel per
 * frame factor + clamp range) — neon/glow/gradient content needs far more
 * bitrate than camera footage to avoid banding and blocking.
 */
export type ExportQuality = 'standard' | 'high' | 'max'

export interface ExportSettings {
  format: ExportFormat
  fps: 24 | 30 | 60
  resolution: ExportResolution
  length: ExportLength
  quality: ExportQuality
  /** Song position (seconds) a sample export (15s/30s) starts at — both the
   * video render and the muxed audio slice read from here. Full-song exports
   * ignore it. */
  startSec: number
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'converting' | 'done'
  /** 0..1 overall progress */
  progress: number
  /** Current render time within the song (seconds) */
  time: number
}

/* --------------------------------- Presets ----------------------------------- */

export const GRADIENT_PRESETS: Record<GradientPresetId, { name: string; stops: ColorStop[] }> = {
  sunset: {
    name: 'Sunset',
    stops: [
      { color: '#f97316', position: 0, opacity: 100 },
      { color: '#ec4899', position: 50, opacity: 100 },
      { color: '#8b5cf6', position: 100, opacity: 100 },
    ],
  },
  aurora: {
    name: 'Aurora',
    stops: [
      { color: '#06b6d4', position: 0, opacity: 100 },
      { color: '#10b981', position: 50, opacity: 100 },
      { color: '#a3e635', position: 100, opacity: 100 },
    ],
  },
  ember: {
    name: 'Ember',
    stops: [
      { color: '#dc2626', position: 0, opacity: 100 },
      { color: '#f97316', position: 55, opacity: 100 },
      { color: '#fbbf24', position: 100, opacity: 100 },
    ],
  },
  neon: {
    name: 'Neon',
    stops: [
      { color: '#22c55e', position: 0, opacity: 100 },
      { color: '#e2e8f0', position: 50, opacity: 100 },
      { color: '#22d3ee', position: 100, opacity: 100 },
    ],
  },
  mono: {
    name: 'Mono',
    stops: [
      { color: '#e5e5e5', position: 0, opacity: 100 },
      { color: '#a3a3a3', position: 50, opacity: 100 },
      { color: '#525252', position: 100, opacity: 100 },
    ],
  },
}

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  fonts: [],
  visualizer: {
    style: 'bars',
    barCount: 64,
    smoothing: 0.7,
    sensitivity: 1.2,
    roundness: 0.6,
    gap: 0.35,
    mirror: 'none',
    mirrorOffset: 0.5,
    glow: true,
    positionX: 50,
    positionY: 50,
    scale: 1,
    layer: 'front',
    orientation: 'horizontal',
    anchor: 'right',
    transparency: 0,
    flowSpeed: 0.5,
    perspUp: '#ff1f1f',
    perspDown: '#1e6bff',
    perspTexture: 0.45,
    perspEcho: 0.55,
    perspMirrorDrop: 0,
    terrainFill: 0.4,
    terrainMirrorDrop: 0,
    sphereSpin: 0.35,
    sphereQuills: 0.6,
    // The reference look: the whole ball visible in the center, the
    // picture bending away and fading toward the screen edges around it.
    dotSphereSize: 0.75,
    dotSphereRows: 56,
    dotSphereDotSize: 1,
    dotSphereFlow: 0.6,
    dotSphereWave: 0.6,
    dotSphereWaveScale: 5,
    dotSphereWaveSpeed: 0.9,
    dotSphereTwist: 0.9,
    dotSphereRipple: 0.35,
    dotSphereGlow: 0.55,
    dotSphereColors: 'neon',
    dotSphereFace: 'dark',
    dotSphereFaceColor: '#050109',
    dotSphereFaceSrc: '',
    dotSphereBeat: false,
    dotSphereBeatStrength: 0.5,
    seratoWindow: 12,
    seratoHeight: 0.62,
    seratoColors: 'rainbow',
    imgvizSrc: '',
    imgvizSize: 55,
    imgvizDim: 0.35,
    imgvizInner: 'bars',
    imgvizInnerGain: 1,
    imgvizInnerX: 50,
    imgvizInnerY: 50,
    imgvizInnerOrient: 'horizontal',
    imgvizMotion: true,
    imgvizMotionAmount: 0.5,
    imgvizGlow: true,
    imgvizGlowMode: 'palette',
    imgvizGlowColor: '#ffffff',
    imgvizGlowStrength: 0.75,
    imgvizGlowPlacement: 'over',
    imgvizBolt: true,
    imgvizBoltMode: 'palette',
    imgvizBoltColor: '#7df9ff',
    imgvizBoltDensity: 0.5,
    imgvizBoltLength: 1,
    gradient: {
      stops: [...GRADIENT_PRESETS.sunset.stops.map((s) => ({ ...s }))],
      angle: 48,
      shape: 'linear',
      cycleColors: false,
      cycleSpeed: 0.25,
    },
  },
  background: {
    mode: 'solid',
    color: '#0a0a0a',
    gradient: {
      stops: [
        { color: '#1e1b4b', position: 0, opacity: 100 },
        { color: '#0a0a0a', position: 100, opacity: 100 },
      ],
      angle: 160,
      shape: 'linear',
      cycleColors: false,
      cycleSpeed: 0.15,
    },
    imageSrc: '',
    videoSrc: '',
    x: 0,
    y: 0,
    scale: 1,
    flipX: false,
    flipY: false,
    // Factory 0% — uploaded pictures show at full brightness; the Shade dial
    // is there when a project needs darkening for readability.
    shade: 0,
    vignette: 0.35,
    grain: 0.08,
    blur: 0,
    pulse: 0,
    shake: 0,
    blurPulse: 0,
    beatFlip: false,
    flipSensitivity: 0.1,
    flipHold: 0.2,
    // The background video's own sound stays muted until the user opts in.
    videoAudio: false,
  },
  lyrics: {
    enabled: false,
    lines: [],
    font: 'sans',
    size: 42,
    weight: 600,
    positionY: 78,
    color: '#ffffff',
    fade: 0.35,
    uppercase: false,
    holdTime: 4,
    echo: true,
    fill: 'solid',
    gradientMode: 'visualizer',
    gradient: {
      stops: [...GRADIENT_PRESETS.sunset.stops.map((s) => ({ ...s }))],
      angle: 90,
      shape: 'linear',
      cycleColors: false,
      cycleSpeed: 0.25,
    },
    outline: false,
    outlineWidth: 3,
    outlineColor: '#000000',
    glow: false,
    glowStrength: 0.5,
    glowColor: '#ffffff',
    opacity: 1,
  },
  title: {
    enabled: false,
    text: 'SONG TITLE',
    startTime: 0,
    duration: 6,
    fade: 0.8,
    font: 'sans',
    size: 64,
    weight: 800,
    uppercase: true,
    positionX: 50,
    positionY: 38,
    pulse: 0,
    swivel: false,
    swivelRange: 12,
    swivelSpeed: 0.4,
    fill: 'gradient',
    gradientMode: 'visualizer',
    gradient: {
      stops: [...GRADIENT_PRESETS.sunset.stops.map((s) => ({ ...s }))],
      angle: 90,
      shape: 'linear',
      cycleColors: false,
      cycleSpeed: 0.25,
    },
    color: '#ffffff',
    outline: false,
    outlineWidth: 3,
    outlineColor: '#000000',
    glow: true,
    glowStrength: 0.6,
    glowColor: '#ffffff',
  },
  disc: {
    enabled: false,
    imageSrc: '',
    discImageSrc: '',
    showCover: true,
    coverSize: 42,
    coverX: 30,
    coverY: 50,
    coverArtZoom: 1,
    coverArtX: 50,
    coverArtY: 50,
    showDisc: true,
    mode: 'label',
    discSize: 46,
    discX: 46,
    discY: 50,
    discInFront: false,
    discArtZoom: 1,
    discArtX: 50,
    discArtY: 50,
    cassetteStyle: 'vector',
    shellColor: '#2f2f34',
    cassetteLabel: 'default',
    stripes: ['#e5325c', '#2bb3e6', '#f2c722'],
    labelColor: '#f7f4ec',
    labelText: '',
    labelTextColor: '#1c1c1e',
    shadowDepth: 55,
    shadowAngle: 90,
    shadowColor: '#000000',
    rpm: 33.33,
    direction: 1,
    pulse: 0,
    grooves: true,
    sheen: 0.35,
  },
  watermark: {
    enabled: false,
    imageSrc: '',
    text: '',
    position: 'br',
    size: 56,
    opacity: 0.85,
  },
  screenFilter: {
    enabled: false,
    size: 3,
    scanlines: 0.45,
    grille: 0.5,
    aberration: 0.3,
    glow: 0.3,
    beatReactive: false,
    beatStrength: 0.5,
  },
  vhsFilter: {
    enabled: false,
    wobble: 0.5,
    tracking: 0.5,
    trackingSpeed: 0.5,
    dust: 0.4,
    beatReactive: false,
    beatStrength: 0.5,
  },
  camcorderFilter: {
    enabled: false,
    // The Backrooms preset's own dial settings, captured from the live
    // editor's uniform stream — these ARE the shipped look.
    resolution: 420,
    distortion: 0,
    colorFringing: 0,
    wobble: 0.59,
    tapeCrease: 0.37,
    trackingNoise: 2,
    verticalJump: 0.01,
    sparkle: 0.31,
    flicker: 0.06,
    grain: 0.75,
    saturation: 1,
    colorShift: 0.1,
    colorBlend: 1,
    softness: 0.4,
    colorDelay: 4.8,
    sharpening: 1.14,
    blur: 3.87,
    blurMix: 0.05,
    gradeStrength: 1,
    beatReactive: false,
    beatStrength: 0.5,
  },
  filmFilter: {
    enabled: false,
    scratches: 0.5,
    dust: 0.5,
    speed: 0.5,
    flicker: 0.35,
    beatReactive: false,
    beatStrength: 0.5,
  },
  halftoneFilter: {
    enabled: false,
    dotSize: 6,
    dotRange: 0.55,
    strength: 0.9,
    beatReactive: false,
    beatStrength: 0.5,
    beatFlip: false,
    beatFlipTo: 'picture',
    flipSensitivity: 0.5,
    flipHold: 0.2,
    flipMono: false,
    grayscale: false,
    contrast: 0.5,
    invert: false,
    inkColor: '#000000',
    gradient: false,
    inkColor2: '#f59e0b',
    gradientMotion: 0.5,
    printOnly: false,
    backdropColor: '#ffffff',
    backdropGradient: false,
    backdropColor2: '#fbbf24',
    backdropMotion: 0.5,
    imageFill: false,
  },
  glitchFilter: {
    enabled: false,
    blocks: 0.5,
    slices: 0.5,
    rate: 0.5,
    beatReactive: false,
    beatStrength: 0.5,
    randomize: false,
    randomStepMin: 0.03,
    randomStepMax: 0.2,
    randomStepTime: 1,
  },
  anaglyphFilter: {
    enabled: false,
    depth: 0.5,
    reactivity: 0.5,
    beatReactive: false,
    beatFlip: false,
    flipSensitivity: 0.1,
    flipHold: 0.2,
    beatFlipTo: 'around',
    depthPop: false,
    popSensitivity: 0.1,
    popHold: 0.2,
    depthMode: 'sides',
    strength: 1,
    leftColors: ['#ff0000'],
    rightColors: ['#00ffff'],
  },
  neonSplitFilter: {
    enabled: false,
    ramp: 'violet',
    contrast: 0.5,
    grain: 0.5,
    grainSpeed: 0.5,
    glow: 0.6,
    bloomThreshold: 0.5,
    bloomSoftness: 0.5,
    bloomMix: 0.5,
    mapAmount: 1,
    grainSize: 0.5,
    grainChroma: 0.69,
    grainShadow: 0.5,
    grainHighlight: 0.5,
    split: 0,
    strength: 1,
  },
  colorGradeFilter: {
    enabled: false,
    look: 'bw',
    strength: 1,
    contrast: 0.5,
    warmth: 0.5,
  },
  gradientMapFilter: {
    enabled: false,
    // effect.app's Gradient Map feature defaults: the house ramp at full
    // opacity, the window unshifted and untiled, motion off (the shift
    // dial is manual) — flipping the switch alone repaints the picture
    // through the ramp, exactly like the site's effect does
    preset: 'neon',
    blend: 'normal',
    opacity: 1,
    shift: 0,
    repeat: 1,
    shiftMode: 'manual',
    shiftSpeed: 0.3,
    beatStep: 0.25,
    beatDir: 'forward',
    beatSens: 0.12,
    beatEase: 0.14,
    randomStepMin: 0.03,
    randomStepMax: 0.2,
    randomStepTime: 0.5,
    // Custom ramp seed — the Neon stops verbatim, so picking Custom
    // starts as the house look and the stop editor takes it from there
    customStops: [
      { t: 0, c: '#000000' },
      { t: 0.406, c: '#002266' },
      { t: 0.857, c: '#d55fec' },
      { t: 1, c: '#ffd6fa' },
    ],
  },
  halationFilter: {
    enabled: false,
    // effect.app's published Halation defaults — the tint is the Kodak-look
    // halo color
    threshold: 0.6,
    knee: 0.25,
    boost: 0.5,
    localDiffusion: 0.04,
    globalDiffusion: 0.12,
    intensity: 0.7,
    tint: '#ff4d21',
    backgroundGain: 0.85,
    blueComp: 0.5,
    beatReactive: false,
    beatStrength: 0.5,
    beatFlip: false,
    beatFlipTo: 'print',
    flipSensitivity: 0.1,
    flipHold: 0.2,
  },
  exposureFilter: {
    enabled: false,
    // effect.app's published Instant Film defaults — the first stock in its
    // Type list and the Amount pad at center (1, 1)
    stock: 'polaroid-600',
    color: 1,
    light: 1,
  },
  textureFilter: {
    enabled: false,
    // 'paper' first — the most legible displacement demo — at a strong
    // but not overwhelming amount, features at the reference size
    type: 'paper',
    amount: 0.6,
    scale: 1,
    // The custom texture: no image until the user uploads one, one tile
    // cover-fitting the frame, dead-center, unrotated, linear contrast,
    // highlights and shadows both at full strength and neutral colors,
    // warp off (the picture stays pixel-crisp until asked to bend)
    customSrc: '',
    customSize: 1,
    customX: 0,
    customY: 0,
    customRotate: 0,
    customContrast: 1,
    customHighlights: 1,
    customHighlightColor: '#ffffff',
    customShadows: 1,
    customShadowColor: '#000000',
    customWarp: false,
    customWarpStrength: 0.35,
  },
  polaroidFilter: {
    enabled: false,
    // Mid density + a good scatter = the reference pile: overlapping prints
    // tilted off their slots, the picture living in every photo square
    density: 0.5,
    scatter: 0.45,
    backdrop: 'paper',
    backdropColor: '#2e2e35',
    gridSplit: false,
    splitAmount: 0.5,
    beatReactive: false,
    beatStrength: 0.5,
    photoMode: 'video',
    photoSrc: '',
    mosaicSrc: '',
    photoZoom: 1,
    mosaicZoom: 1,
    mosaicPanX: 0,
    mosaicPanY: 0,
    mosaicRot: 0,
    strength: 1,
  },
  ditherFilter: {
    enabled: false,
    mode: 'blue',
    blueInkColor: '#49b6ff',
    bluePaperColor: '#030a24',
    cellSize: 4,
    contrast: 0.5,
    strength: 1,
    glow: 0.55,
    inkColor: '#49b6ff',
    paperColor: '#030a24',
    beatReactive: false,
    beatStrength: 0.5,
    macPatterns: [0, 2, 6, 17, 28, 33, 36, 37],
    macBitmapWidth: 342,
    macThreshold: 0.354,
    macContrast: 2.5,
    macGrain: 0,
    macSmoothing: 1,
    macSharpen: -0.83,
    macRadius: 1.2,
    macEdgeMode: 1,
    macEdgeThreshold: 0.1,
    macEdgeWidth: 1.1,
    macInkColor: '#0f0f12',
    macPaperColor: '#f7f5eb',
  },
  phosphorFilter: {
    enabled: false,
    mode: 'lines',
    inkColor: '#3dff7c',
    paperColor: '#03160c',
    cellSize: 5,
    gap: 0.4,
    contrast: 0.5,
    strength: 1,
    glow: 0.55,
    beatReactive: false,
    beatStrength: 0.5,
  },
  contourFilter: {
    enabled: false,
    lines: 96,
    warp: 0.55,
    motion: 0.35,
    reactivity: 0.6,
    inkColor: '#49b6ff',
    paperColor: '#030a24',
    glow: 0.6,
    stillness: 0.6,
    waveSpread: 0.6,
    strength: 1,
    beatReactive: false,
    beatStrength: 0.5,
  },
  cubifyFilter: {
    enabled: false,
    shapes: ['cube'],
    scale: 0.6,
    stretch: -0.21,
    depth: 1.8,
    hard: false,
    angle: 35,
    offsetX: 0,
    offsetY: 0,
    speedX: -0.34,
    speedY: 0.34,
    dispersion: 0.75,
    blend: 1,
    beatReactive: false,
    beatStrength: 0.5,
  },
  kaleidoscopeFilter: {
    enabled: false,
    segments: 8,
    spin: 0.05,
    zoom: 1.4,
    mirrorMode: 'alternate',
    wander: 0,
    wanderSpeed: 0.5,
    breathe: 0,
    centerX: 50,
    centerY: 50,
    blend: 1,
    beatReactive: false,
    beatStrength: 0.5,
  },
  waveWarpFilter: {
    enabled: false,
    amplitude: 22,
    density: 2.5,
    speed: 0.8,
    blend: 1,
    beatReactive: false,
    beatStrength: 0.5,
  },
  vignetteFilter: {
    enabled: false,
    amount: 0.55,
    reach: 0.5,
    softness: 0.6,
    edgeBlur: false,
    tintColor: '#000000',
    beatReactive: false,
    beatStrength: 0.5,
  },
  shakeFilter: {
    enabled: false,
    amount: 10,
    speed: 1,
    wobble: 0.4,
    beatReactive: false,
    beatStrength: 0.5,
  },
  strobeFilter: {
    enabled: false,
    frequency: 2,
    mix: 1,
    colorOverlay: false,
    overlayColor: '#ff3b5c',
    randomColorOnBeat: false,
    beatReactive: false,
    beatStrength: 0.5,
  },
  layers: {
    stayColored: false,
    textClear: false,
    filterAlpha: 1,
  },
  pulseImage: {
    enabled: false,
    imageSrc: '',
    x: 50,
    y: 50,
    size: 30,
    pulse: 0.6,
    spin: false,
    spinSpeed: 1,
    glow: true,
    glowColorMode: 'palette',
    glowColor: '#ffffff',
    glowStrength: 0.7,
    tint: 0,
    tintLow: '#ff3b5c',
    tintHigh: '#2bffa8',
    outline: false,
    outlineWidth: 0.4,
    outlineColor: '#ffffff',
    layer: 'front',
  },
}

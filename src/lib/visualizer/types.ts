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

export type VisualizerStyle = 'bars' | 'wave' | 'radial' | 'particles' | 'blob' | 'grid' | 'ribbon' | 'perspective' | 'terrain' | 'sphere' | 'serato' | 'imgviz'
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
  /** Vertical anchor of the mirror/center axis, 0 = top edge · 0.5 = middle
   *  (default) · 1 = bottom edge. Used by bars / wave / grid. */
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
   *  every mode). Mirror mode: slides ONLY the lake on its own axis — the
   *  range stays planted on its shore. Positive sinks the water line
   *  toward the bottom edge (the lake detaches from the shore; the flipped
   *  peaks may run past the bottom edge like a real lake bigger than the
   *  frame), negative raises it into the range (high water: the submerged
   *  foothills dim and the lake reflects the peaks still above the line —
   *  the travel spans the range's full height). The reflection is always
   *  the exact 1:1 flip of the land above the line. Center mode: Spread —
   *  how deep the range's own underside grows (negative shallower,
   *  positive deeper). */
  terrainMirrorDrop: number
  /** Sphere style — spin speed 0..1. How fast the dot-matrix planet turns
   *  around its tilted axis (0 = a slow drift, 1 = a fast whirl). */
  sphereSpin: number
  /** Sphere style — audio quills 0..1. Every dot grows a spike outward with
   *  its own frequency band's energy (the bass equator surges, the treble
   *  poles crackle). 0 = the smooth pulsing shell, dots glued to the surface. */
  sphereQuills: number
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
  /** Image style — glow strength 0..1 */
  imgvizGlowStrength: number
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
  /** Video/GIF data URL (used when mode = video), looping and muted */
  videoSrc: string
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
  /** Full-frame film-damage post-pass (scratches + dust + flicker) */
  filmFilter: FilmFilterConfig
  /** Full-frame print post-pass (45° halftone dots on darker tones) */
  halftoneFilter: HalftoneFilterConfig
  /** Full-frame digital-corruption post-pass (bursty glitch artifacts) */
  glitchFilter: GlitchFilterConfig
  /** Full-frame anaglyph post-pass (red/cyan 3D-glasses re-projection) */
  anaglyphFilter: AnaglyphFilterConfig
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
}

/** Stateless, pure render call: same inputs → same pixels. */
export type RenderFrameFn = (rc: RenderContext, frame: AudioFrame, config: StudioConfig) => void

/* --------------------------------- Export API --------------------------------- */

export type ExportFormat = 'mp4'
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
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'done'
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
    seratoWindow: 12,
    seratoHeight: 0.62,
    seratoColors: 'rainbow',
    imgvizSrc: '',
    imgvizSize: 55,
    imgvizDim: 0.35,
    imgvizInner: 'bars',
    imgvizInnerGain: 1,
    imgvizMotion: true,
    imgvizMotionAmount: 0.5,
    imgvizGlow: true,
    imgvizGlowMode: 'palette',
    imgvizGlowColor: '#ffffff',
    imgvizGlowStrength: 0.6,
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
    strength: 1,
    leftColors: ['#ff0000'],
    rightColors: ['#00ffff'],
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
    tint: 0,
    tintLow: '#ff3b5c',
    tintHigh: '#2bffa8',
    outline: false,
    outlineWidth: 0.4,
    outlineColor: '#ffffff',
    layer: 'front',
  },
}

/**
 * Signature presets — complete looks that ship with the app.
 *
 * Each entry pairs a tiny bit of display metadata with a full .spectra
 * project file served from /public (fetched only when the preset is
 * applied, so big files with baked-in images never weigh down the page).
 * The metadata below mirrors what is inside the file — keep the two in
 * sync when adding or updating a preset.
 *
 * To add one: drop `<id>.spectra` into public/presets/ and append an
 * entry here. Files are exactly what the app's "Download .spectra"
 * button produces, so any look can become a signature preset.
 */
export interface SignaturePreset {
  id: string
  name: string
  /** Relative path of the .spectra file inside /public */
  file: string
  caption: string
  /** Gradient mirrored from the file, for the swatch preview (the palette
   *  that best identifies the look — background or visualizer) */
  swatch: { stops: { color: string; position: number }[]; angle: number }
}

export const SIGNATURE_PRESETS: SignaturePreset[] = [
  {
    id: 'vinyl-and-cover',
    name: 'Vinyl & Cover',
    file: 'presets/vinyl-and-cover.spectra',
    caption: 'Indigo dusk wave · big sleeve with the record sliding out',
    swatch: {
      stops: [
        { color: '#283386', position: 0 },
        { color: '#0a0a0a', position: 100 },
      ],
      angle: 160,
    },
  },
  {
    id: 'radial-fade',
    name: 'Radial Fade',
    file: 'presets/radial-fade.spectra',
    caption: 'Plum-to-white sunburst over a violet bloom',
    swatch: {
      stops: [
        { color: '#271720', position: 12 },
        { color: '#8f6b7c', position: 35 },
        { color: '#ffffff', position: 50 },
      ],
      angle: 90,
    },
  },
  {
    id: 'side-eq-cover',
    name: 'Side EQ Cover',
    file: 'presets/side-eq-cover.spectra',
    caption: 'Green grid EQ down the side · centered cover',
    swatch: {
      stops: [
        { color: '#073b14', position: 0 },
        { color: '#fff700', position: 31 },
        { color: '#fff700', position: 60 },
        { color: '#073b14', position: 96 },
      ],
      angle: 180,
    },
  },
  {
    id: 'cassette-blob',
    name: 'Cassette Blob',
    file: 'presets/cassette-blob.spectra',
    caption: 'Sunset blob backdrop · realistic purple cassette',
    swatch: {
      stops: [
        { color: '#f97316', position: 0 },
        { color: '#ec4899', position: 50 },
        { color: '#8b5cf6', position: 100 },
      ],
      angle: 160,
    },
  },
  {
    id: 'large-vinyl',
    name: 'Large Vinyl',
    file: 'presets/large-vinyl.spectra',
    caption: 'Giant off-center vinyl over a red-gold bloom',
    swatch: {
      stops: [
        { color: '#350d0d', position: 12 },
        { color: '#bb1122', position: 43 },
        { color: '#fbbf24', position: 93 },
      ],
      angle: 160,
    },
  },
  {
    id: 'minimal-grid',
    name: 'Minimal Grid',
    file: 'presets/minimal-grid.spectra',
    caption: 'Monochrome gray grid on near-black',
    swatch: {
      stops: [
        { color: '#e5e5e5', position: 0 },
        { color: '#a3a3a3', position: 50 },
        { color: '#525252', position: 100 },
      ],
      angle: 180,
    },
  },
  {
    id: 'record-phone',
    name: 'Record Phone',
    file: 'presets/record-phone.spectra',
    caption: 'Teal-to-white fade · record stacked above its sleeve',
    swatch: {
      stops: [
        { color: '#0e242f', position: 19 },
        { color: '#6f90a5', position: 46 },
        { color: '#ffffff', position: 93 },
      ],
      angle: 160,
    },
  },
  {
    id: 'cassette-phone',
    name: 'Cassette Phone',
    file: 'presets/cassette-phone.spectra',
    caption: 'Dark cassette over a lavender grid · white-to-teal fade',
    swatch: {
      stops: [
        { color: '#ffffff', position: 23 },
        { color: '#6f90a5', position: 47 },
        { color: '#0e242f', position: 87 },
      ],
      angle: 180,
    },
  },
  // Future entries arrive with the user's own looks (screenshots / .spectra
  // files) — the recipe stays: drop <id>.spectra into public/presets/, add
  // a manifest line here. The three designs explored in Task 57 (Neon Bars,
  // Retro Tape, Aurora Mirror) are documented in worklog.md if ever wanted.
]

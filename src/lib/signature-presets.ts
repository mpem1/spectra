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
    id: 'neon-bars',
    name: 'Neon Bars',
    file: 'presets/neon-bars.spectra',
    caption: 'Cycling neon equalizer · glowing gradient title card',
    swatch: {
      stops: [
        { color: '#a3e635', position: 0 },
        { color: '#22d3ee', position: 52 },
        { color: '#e879f9', position: 100 },
      ],
      angle: 90,
    },
  },
  {
    id: 'retro-tape',
    name: 'Retro Tape',
    file: 'presets/retro-tape.spectra',
    caption: 'Sunset wave over a spinning mixtape cassette',
    swatch: {
      stops: [
        { color: '#ffd166', position: 0 },
        { color: '#ff6b6b', position: 55 },
        { color: '#d72683', position: 100 },
      ],
      angle: 90,
    },
  },
  {
    id: 'aurora-mirror',
    name: 'Aurora Mirror',
    file: 'presets/aurora-mirror.spectra',
    caption: 'Twin aurora waves folded around the center',
    swatch: {
      stops: [
        { color: '#06b6d4', position: 0 },
        { color: '#10b981', position: 52 },
        { color: '#a3e635', position: 100 },
      ],
      angle: 90,
    },
  },
]

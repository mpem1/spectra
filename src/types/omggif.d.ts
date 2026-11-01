/** Minimal ambient types for the dependency-free `omggif` GIF decoder. */
declare module 'omggif' {
  export interface GifFrameInfo {
    x: number
    y: number
    width: number
    height: number
    has_local_palette: boolean
    disposal: number
    /** Frame delay in milliseconds */
    delay: number
    interlaced: boolean
    palette_size: number
  }

  export class GifReader {
    constructor(bytes: Uint8Array)
    width: number
    height: number
    numFrames(): number
    frameInfo(index: number): GifFrameInfo
    /** Composite frame `index` into `rgbaPixels` (handles disposal). */
    decodeAndBlitFrameRGBA(index: number, rgbaPixels: Uint8ClampedArray): void
  }
  export class GifWriter {
    /* encoding not used by Spectra */
    [key: string]: unknown
  }
}

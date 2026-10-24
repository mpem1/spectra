/**
 * Background-image cache.
 *
 * The renderer needs SYNCHRONOUS access to a decoded image every frame, so
 * decoded HTMLImageElements are cached per source (data URL). While an image
 * is still decoding the renderer skips drawing it (dark fallback); the live
 * preview repaints every frame, so the image appears the moment it is ready.
 * Export paths call loadBackgroundImage() up-front so frame 0 is exact.
 */
const cache = new Map<string, HTMLImageElement>()

/** Returns the decoded image, or null while it is still loading. */
export function getBackgroundImage(src: string): HTMLImageElement | null {
  if (!src) return null
  let img = cache.get(src)
  if (!img) {
    img = new Image()
    img.decoding = 'sync'
    img.src = src
    cache.set(src, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

/** Resolves once the image is decoded (or rejects on error). Export-safe. */
export function loadBackgroundImage(src: string): Promise<HTMLImageElement> {
  if (!src) return Promise.reject(new Error('No background image set'))
  let img = cache.get(src)
  if (!img) {
    img = new Image()
    img.decoding = 'sync'
    img.src = src
    cache.set(src, img)
  }
  return new Promise((resolve, reject) => {
    if (img && img.complete && img.naturalWidth > 0) {
      resolve(img)
      return
    }
    const el = img as HTMLImageElement
    el.onload = () =>
      el.naturalWidth > 0 ? resolve(el) : reject(new Error('Background image failed to decode'))
    el.onerror = () => reject(new Error('Background image could not be loaded'))
  })
}

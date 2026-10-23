/**
 * Module-level singleton holding the live preview <canvas> element.
 * Used by the snapshot button and any capture/export pipeline that
 * needs to grab pixels from the preview surface.
 */
let canvas: HTMLCanvasElement | null = null

export function setPreviewCanvas(el: HTMLCanvasElement | null): void {
  canvas = el
}

export function getPreviewCanvas(): HTMLCanvasElement | null {
  return canvas
}

/**
 * Registry for per-frame capture hooks driven by the visualizer render loop.
 *
 * The rAF loop in `visualizer-stage.tsx` calls the active sink once per drawn
 * frame with the live canvas. Recorders (MP4 / PNG sequence) register a sink
 * while capturing and clear it when done — this keeps the render loop fully
 * decoupled from any specific export implementation.
 */
export type FrameSink = (canvas: HTMLCanvasElement, nowMs: number) => void

let sink: FrameSink | null = null

export function setFrameSink(next: FrameSink | null): void {
  sink = next
}

export function getFrameSink(): FrameSink | null {
  return sink
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Move } from 'lucide-react'
import { useStudioStore } from '@/store/studio'

/** Normalized-transform limits shared with the Zoom slider in the Style tab. */
const MIN_SCALE = 0.1
const MAX_SCALE = 5
const XY_LIMIT = 1

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type DragState =
  | { kind: 'move'; px: number; py: number; x: number; y: number }
  | { kind: 'scale'; px: number; py: number; cx: number; cy: number; startDist: number; scale: number }

/**
 * Pointer surface over the preview while an image background is active:
 * drag anywhere to move the image, drag the corner handle (or scroll) to
 * zoom. Writes normalized x/y/scale back into the store, so exports at any
 * resolution reproduce the exact framing.
 */
export function BgImageTransform() {
  const mode = useStudioStore((s) => s.config.background.mode)
  const imageSrc = useStudioStore((s) => s.config.background.imageSrc)
  const patchBackground = useStudioStore((s) => s.patchBackground)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [active, setActive] = useState(false)

  const onPointerDownMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      e.preventDefault()
      e.stopPropagation()
      // A stale text selection turns the drag into a selection drag and the
      // browser fires pointercancel — clear it so the move always starts.
      document.getSelection()?.removeAllRanges()
      const surface = surfaceRef.current
      if (!surface) return
      surface.setPointerCapture(e.pointerId)
      const bg = useStudioStore.getState().config.background
      dragRef.current = { kind: 'move', px: e.clientX, py: e.clientY, x: bg.x, y: bg.y }
      setActive(true)
    },
    [],
  )

  const onPointerDownScale = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      e.preventDefault()
      e.stopPropagation()
      document.getSelection()?.removeAllRanges()
      const surface = surfaceRef.current
      if (!surface) return
      surface.setPointerCapture(e.pointerId)
      const rect = surface.getBoundingClientRect()
      const bg = useStudioStore.getState().config.background
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      dragRef.current = {
        kind: 'scale',
        px: e.clientX,
        py: e.clientY,
        cx,
        cy,
        startDist: Math.max(12, Math.hypot(e.clientX - cx, e.clientY - cy)),
        scale: bg.scale,
      }
      setActive(true)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      const surface = surfaceRef.current
      if (!drag || !surface) return
      const rect = surface.getBoundingClientRect()
      if (drag.kind === 'move') {
        const nx = clamp(drag.x + (e.clientX - drag.px) / rect.width, -XY_LIMIT, XY_LIMIT)
        const ny = clamp(drag.y + (e.clientY - drag.py) / rect.height, -XY_LIMIT, XY_LIMIT)
        patchBackground({ x: nx, y: ny })
      } else {
        const dist = Math.max(12, Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy))
        patchBackground({ scale: clamp((dist / drag.startDist) * drag.scale, MIN_SCALE, MAX_SCALE) })
      }
    },
    [patchBackground],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
    setActive(false)
  }, [])

  /* Wheel zoom — needs a non-passive native listener to preventDefault.
     NOTE: no deps array on purpose. The component mounts while mode !==
     'image' (surfaceRef is null then), and the surface div only appears on
     a later render; re-running on every render keeps the listener on the
     live node. */
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const bg = useStudioStore.getState().config.background
      const next = bg.scale * Math.exp(-e.deltaY / 600)
      patchBackground({ scale: clamp(next, MIN_SCALE, MAX_SCALE) })
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  })

  if (mode !== 'image' || !imageSrc) return null

  return (
    <div
      ref={surfaceRef}
      className="group absolute inset-0 z-10 touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-active={active || undefined}
    >
      {/* Move surface */}
      <div
        className="absolute inset-0 cursor-move"
        onPointerDown={onPointerDownMove}
        aria-label="Background image: drag to move, scroll to zoom"
      />

      {/* Frame + handles become visible on hover or while dragging */}
      <div
        aria-hidden
        className={
          'pointer-events-none absolute inset-1.5 rounded-md border border-dashed transition-opacity duration-150 ' +
          (active ? 'border-emerald-400/80 opacity-100' : 'border-emerald-400/50 opacity-0 group-hover:opacity-100')
        }
      />

      {/* Corner resize handle — small visual square, ~44px hit area */}
      <div
        className="absolute -bottom-2 -right-2 flex size-11 cursor-nwse-resize items-center justify-center"
        onPointerDown={onPointerDownScale}
        aria-label="Resize background image"
      >
        <span
          className={
            'size-3 rounded-sm border-2 border-zinc-950 bg-emerald-400 shadow transition-transform duration-150 ' +
            (active ? 'scale-125' : 'scale-90 group-hover:scale-100')
          }
        />
      </div>

      {/* Hint chip */}
      <div
        aria-hidden
        className={
          'pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-950/85 px-2.5 py-1 text-[10px] font-medium text-zinc-300 backdrop-blur transition-opacity duration-150 ' +
          (active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
        }
      >
        <Move className="size-3 text-emerald-400" />
        Drag to move · corner or scroll to zoom
      </div>
    </div>
  )
}

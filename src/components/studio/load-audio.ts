'use client'

import { toast } from 'sonner'
import { getEngine } from '@/components/studio/engine-registry'
import { useStudioStore } from '@/store/studio'
import { formatTime } from '@/components/studio/controls'

/**
 * Loads an audio File into the engine + store. Shared by the player-bar
 * upload button and the drop-anywhere handler.
 */
export async function loadAudioFile(file: File): Promise<void> {
  const engine = getEngine()
  if (!engine) {
    toast.error('Audio engine not ready', { description: 'Wait for the preview to mount.' })
    return
  }
  try {
    const meta = await engine.loadFile(file)
    engine.setVolume(useStudioStore.getState().volume)
    engine.setLoop(useStudioStore.getState().loop)
    useStudioStore.getState().setAudioMeta({ name: meta.name, duration: meta.duration })
    toast.success('Audio loaded', {
      description: `${meta.name} · ${formatTime(meta.duration)}`,
    })
  } catch (err) {
    toast.error('Could not load audio', {
      description: err instanceof Error ? err.message : 'Unsupported file.',
    })
  }
}

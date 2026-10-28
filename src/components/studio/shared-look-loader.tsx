'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { clearLookParam, decodeLook, readLookParam } from '@/lib/share-link'
import { useStudioStore } from '@/store/studio'

/**
 * Consumes `?p=<shared look>` once on mount: applies the config, nudges the
 * visitor to save it as their own, and cleans the address bar so reloading
 * doesn't silently resurrect the shared look over their own tweaks.
 *
 * The toast is deferred: toasts fired in the exact commit where the
 * <Toaster /> first mounts never become visible.
 */
export function SharedLookLoader() {
  const setConfig = useStudioStore((s) => s.setConfig)
  const setProjectId = useStudioStore((s) => s.setProjectId)

  useEffect(() => {
    const token = readLookParam()
    if (!token) return
    clearLookParam()
    const config = decodeLook(token)

    if (config) {
      setConfig(config)
      setProjectId(null)
    }

    const timer = setTimeout(
      () => {
        if (!config) {
          toast.error('That share link is broken or truncated', {
            description:
              'Ask for a fresh link — it may have been cut off by the app you pasted it into.',
          })
          return
        }
        toast.success('Shared look loaded', {
          description: 'Tweak anything, then hit Save to make it yours.',
        })
      },
      150,
    )
    return () => clearTimeout(timer)
  }, [setConfig, setProjectId])

  return null
}

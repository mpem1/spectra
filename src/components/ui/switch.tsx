"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * Studio switch — state colors are hardcoded (not theme vars) so ON vs OFF is
 * unmistakable on the dark panels: ON = emerald track + white knob, OFF =
 * visible zinc track + light knob. Both states are solid, never translucent.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-emerald-400 focus-visible:ring-emerald-500/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-emerald-600 data-[state=checked]:shadow-[0_0_10px_-2px] data-[state=checked]:shadow-emerald-500/60 data-[state=unchecked]:border-zinc-600 data-[state=unchecked]:bg-zinc-700",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-zinc-200 shadow transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=checked]:bg-white data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

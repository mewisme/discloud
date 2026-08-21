"use client"

import { createContext, type ReactNode, useCallback, useContext, useState } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

export type BottomDockSlot = "file-browser" | "selection" | "uploads"

type BottomDockTargets = Record<BottomDockSlot, HTMLElement | null>

const BottomDockStackContext = createContext<BottomDockTargets | null>(null)

export function BottomDockStackProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<BottomDockTargets>({
    "file-browser": null,
    selection: null,
    uploads: null,
  })

  const setTarget = useCallback((slot: BottomDockSlot, node: HTMLElement | null) => {
    setTargets((current) => {
      if (current[slot] === node) return current
      return { ...current, [slot]: node }
    })
  }, [])

  const uploadsRef = useCallback(
    (node: HTMLDivElement | null) => setTarget("uploads", node),
    [setTarget],
  )
  const selectionRef = useCallback(
    (node: HTMLDivElement | null) => setTarget("selection", node),
    [setTarget],
  )
  const fileBrowserRef = useCallback(
    (node: HTMLDivElement | null) => setTarget("file-browser", node),
    [setTarget],
  )

  return (
    <BottomDockStackContext.Provider value={targets}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex flex-col gap-3 px-3">
        <div ref={uploadsRef} className="flex w-full justify-center empty:hidden" />
        <div ref={selectionRef} className="flex w-full justify-center empty:hidden" />
        <div ref={fileBrowserRef} className="flex w-full justify-center empty:hidden" />
      </div>
    </BottomDockStackContext.Provider>
  )
}

export function BottomDock({
  slot,
  className,
  children,
}: {
  slot: BottomDockSlot
  className?: string
  children: ReactNode
}) {
  const targets = useContext(BottomDockStackContext)
  if (!targets) throw new Error("BottomDock must be used inside BottomDockStackProvider")

  const target = targets[slot]
  if (!target) return null

  return createPortal(
    <div className={cn("pointer-events-auto max-w-[calc(100vw-1.5rem)]", className)}>
      {children}
    </div>,
    target,
  )
}
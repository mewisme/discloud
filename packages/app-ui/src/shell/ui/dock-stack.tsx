"use client"

import { cn } from "@discloud/ui/lib/utils"
import { createContext, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

export type BottomDockSlot = "network" | "selection" | "uploads" | "file-browser"

type DockBoundary = { left: number; right: number }
type DockStackContextValue = {
  boundary: DockBoundary
  targets: Record<BottomDockSlot, HTMLElement | null>
}

const defaultBoundary: DockBoundary = { left: 0, right: 0 }
const DockStackContext = createContext<DockStackContextValue | null>(null)

export function DockStackProvider({ children }: { children: ReactNode }) {
  const [boundary, setBoundary] = useState<DockBoundary>(defaultBoundary)
  const [targets, setTargets] = useState<Record<BottomDockSlot, HTMLElement | null>>({ network: null, selection: null, uploads: null, "file-browser": null })
  const setTarget = useCallback((slot: BottomDockSlot, node: HTMLElement | null) => {
    setTargets((current) => current[slot] === node ? current : { ...current, [slot]: node })
  }, [])
  const networkRef = useCallback((node: HTMLDivElement | null) => setTarget("network", node), [setTarget])
  const selectionRef = useCallback((node: HTMLDivElement | null) => setTarget("selection", node), [setTarget])
  const uploadsRef = useCallback((node: HTMLDivElement | null) => setTarget("uploads", node), [setTarget])
  const fileBrowserRef = useCallback((node: HTMLDivElement | null) => setTarget("file-browser", node), [setTarget])

  useEffect(() => {
    let inset: HTMLElement | null = null
    let resizeObserver: ResizeObserver | undefined
    let frame = 0

    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = inset?.getBoundingClientRect()
        const next = rect
          ? { left: Math.max(0, rect.left), right: Math.max(0, window.innerWidth - rect.right) }
          : defaultBoundary

        setBoundary((current) => current.left === next.left && current.right === next.right ? current : next)
      })
    }

    const connect = () => {
      const next = document.querySelector<HTMLElement>("[data-slot='sidebar-inset']")
      if (next !== inset) {
        resizeObserver?.disconnect()
        inset = next
        if (inset) {
          resizeObserver = new ResizeObserver(measure)
          resizeObserver.observe(inset)
        }
      }
      measure()
    }

    const mutationObserver = new MutationObserver(connect)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener("resize", measure)
    connect()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  const value = useMemo(() => ({ boundary, targets }), [boundary, targets])
  const style = boundaryStyle(boundary)

  return (
    <DockStackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col gap-3 overflow-y-auto" style={style}>
        <div ref={networkRef} className="flex w-full justify-center empty:hidden" />
        <div ref={selectionRef} className="flex w-full justify-center empty:hidden" />
        <div ref={uploadsRef} className="flex w-full justify-center empty:hidden" />
        <div ref={fileBrowserRef} className="flex w-full justify-center empty:hidden" />
      </div>
    </DockStackContext.Provider>
  )
}

export function BottomDock({ slot, className, children }: { slot: BottomDockSlot; className?: string; children: ReactNode }) {
  const context = useDockStack()
  const target = context.targets[slot]
  if (!target) return null

  return createPortal(<div className={cn("pointer-events-auto min-w-0 max-w-full", className)}>{children}</div>, target)
}

export function SideDock({ side = "right", className, children }: { side?: "left" | "right"; className?: string; children: ReactNode }) {
  const { boundary } = useDockStack()
  if (typeof document === "undefined") return null

  const style: CSSProperties = side === "left"
    ? { left: `calc(${boundary.left}px + 1rem + env(safe-area-inset-left))` }
    : { right: `calc(${boundary.right}px + 1rem + env(safe-area-inset-right))` }

  return createPortal(
    <div className={cn("pointer-events-none fixed top-1/2 z-30 max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] -translate-y-1/2", className)} style={style}>
      {children}
    </div>,
    document.body,
  )
}

function useDockStack() {
  const context = useContext(DockStackContext)
  if (!context) throw new Error("Dock components must be used inside DockStackProvider")
  return context
}

function boundaryStyle(boundary: DockBoundary): CSSProperties {
  return {
    left: `calc(${boundary.left}px + 1rem + env(safe-area-inset-left))`,
    right: `calc(${boundary.right}px + 1rem + env(safe-area-inset-right))`,
  }
}

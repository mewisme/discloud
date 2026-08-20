"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

export function RouteFocusManager() {
  const pathname = usePathname()
  const initial = useRef(true)
  const [announcement, setAnnouncement] = useState("")

  useEffect(() => {
    if (initial.current) {
      initial.current = false
      return
    }

    const frame = requestAnimationFrame(() => {
      const main = document.getElementById("main-content")
      main?.focus({ preventScroll: true })

      const heading = main?.querySelector("h1")?.textContent?.trim()
      const title = heading || document.title.split(" | ")[0]?.trim() || "Page"
      setAnnouncement(`${title} loaded`)
    })

    return () => cancelAnimationFrame(frame)
  }, [pathname])

  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  )
}
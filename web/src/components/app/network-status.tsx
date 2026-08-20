"use client"

import { WifiOffIcon } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

function subscribe(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)

  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

function getSnapshot() {
  return navigator.onLine
}

function getServerSnapshot() {
  return true
}

export function NetworkStatus() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const previousOnline = useRef<boolean | undefined>(undefined)
  const [announcement, setAnnouncement] = useState("")

  useEffect(() => {
    if (previousOnline.current === undefined) {
      previousOnline.current = online
      return
    }

    if (previousOnline.current !== online) {
      setAnnouncement(online ? "Network connection restored." : "Network connection lost.")
      previousOnline.current = online
    }
  }, [online])

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {!online && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <Alert variant="destructive" className="pointer-events-auto w-full max-w-md bg-background shadow-lg">
            <WifiOffIcon />
            <AlertTitle>You&apos;re offline</AlertTitle>
            <AlertDescription>
              Changes that require the server may fail until your network connection is restored.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </>
  )
}
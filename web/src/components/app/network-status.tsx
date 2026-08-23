"use client"

import { BottomDock } from "@discloud/app-ui/shell/dock-stack"
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
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>

      {!online ? (
        <BottomDock slot="network" className="w-full max-w-md">
          <Alert variant="destructive" className="w-full bg-background shadow-lg">
            <WifiOffIcon />
            <AlertTitle>You&apos;re offline</AlertTitle>
            <AlertDescription>
              <span className="sm:hidden">Server actions may fail until you reconnect.</span>
              <span className="hidden sm:inline">Changes that require the server may fail until your network connection is restored.</span>
            </AlertDescription>
          </Alert>
        </BottomDock>
      ) : null}
    </>
  )
}

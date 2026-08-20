"use client"

import { useSyncExternalStore } from "react"
import { WifiOffIcon } from "lucide-react"
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
  if (online) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <Alert variant="destructive" className="pointer-events-auto w-full max-w-md bg-background shadow-lg">
        <WifiOffIcon />
        <AlertTitle>You&apos;re offline</AlertTitle>
        <AlertDescription>Changes that require the server may fail until your network connection is restored.</AlertDescription>
      </Alert>
    </div>
  )
}
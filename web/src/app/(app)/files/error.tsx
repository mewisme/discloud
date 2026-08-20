"use client"

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function FilesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-4">
        <TriangleAlertIcon className="mx-auto size-10 text-destructive" />
        <div>
          <p className="font-medium">Could not load this folder</p>
          <p className="text-sm text-muted-foreground">The folder may be unavailable or the server could not be reached.</p>
        </div>
        <Button variant="outline" onClick={reset}>
          <RefreshCwIcon />
          Try again
        </Button>
      </div>
    </div>
  )
}
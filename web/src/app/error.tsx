"use client"

import { RefreshCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <TriangleAlert className="size-10 text-destructive" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">The page could not be loaded.</p>
        </div>
        <Button onClick={reset}>
          <RefreshCw />
          Try again
        </Button>
      </div>
    </main>
  )
}
"use client"

import { RefreshCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-dvh place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <TriangleAlert className="size-10 text-destructive" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">DisCloud encountered an error</h1>
              <p className="text-sm text-muted-foreground">Reload the application and try again.</p>
            </div>
            <Button onClick={reset}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        </main>
      </body>
    </html>
  )
}
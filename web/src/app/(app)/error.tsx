"use client"

import { Button } from "@discloud/ui/components/button"
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto grid min-h-[60vh] w-full max-w-3xl place-items-center py-10">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-destructive/10">
          <TriangleAlertIcon className="size-6 text-destructive" />
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Could not load this page</h1>
          <p className="text-sm text-muted-foreground">
            Something went wrong while loading this part of DisCloud.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RefreshCwIcon />
            Try again
          </Button>

          <Button asChild variant="outline">
            <Link href="/">Back to workspace</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
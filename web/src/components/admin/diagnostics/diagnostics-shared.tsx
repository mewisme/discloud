"use client"

import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { AlertCircleIcon, BracesIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useEffect, useRef } from "react"

export const DIAGNOSTICS_PAGE_SIZE = 25

export function InfiniteScrollSentinel({
  loading,
  hasMore,
  error,
  onLoad,
  onRetry,
}: {
  loading: boolean
  hasMore: boolean
  error?: string
  onLoad: () => void
  onRetry: () => void
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onLoadRef = useRef(onLoad)

  useEffect(() => {
    onLoadRef.current = onLoad
  }, [onLoad])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || loading || error) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadRef.current()
      },
      { rootMargin: "320px 0px" },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [error, hasMore, loading])

  return (
    <div ref={sentinelRef} className="flex min-h-10 items-center justify-center border-t">
      {loading && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          Loading more…
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 text-xs text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <RefreshCwIcon />
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && !hasMore && (
        <span className="py-2 text-xs text-muted-foreground">End of results</span>
      )}
    </div>
  )
}

export function JSONDialog({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: unknown
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`View details for ${title}`}>
          <BracesIcon />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const unhealthy = status === "failed"
    || status === "dead"
    || status === "expired"
    || status === "cancelled"

  return (
    <Badge
      variant={
        unhealthy
          ? "destructive"
          : status === "running" || status === "completing"
            ? "secondary"
            : "outline"
      }
      className="capitalize"
    >
      {unhealthy && <AlertCircleIcon />}
      {status}
    </Badge>
  )
}
"use client"

import { Loader2Icon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useUserConfigSelector } from "@/components/settings/user-config-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function PaginationTrigger({
  loadKey,
  hasMore,
  loading,
  onLoadMore,
  className,
  loadingLabel = "Loading more…",
}: {
  loadKey: string
  hasMore: boolean
  loading: boolean
  onLoadMore: () => Promise<void>
  className?: string
  loadingLabel?: string
}) {
  const mode = useUserConfigSelector((config) => config.common.pagination.mode)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef(onLoadMore)
  const requestedKeyRef = useRef<string | undefined>(undefined)
  const [failedKey, setFailedKey] = useState<string>()
  loadMoreRef.current = onLoadMore

  async function request(key: string) {
    if (loading) return
    requestedKeyRef.current = key

    try {
      await loadMoreRef.current()
    } catch {
      setFailedKey(key)
    }
  }

  useEffect(() => {
    if (mode !== "infinite" || !hasMore || loading || failedKey === loadKey || requestedKeyRef.current === loadKey) return

    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || requestedKeyRef.current === loadKey) return
      void request(loadKey)
    }, { rootMargin: "240px" })

    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedKey, hasMore, loadKey, loading, mode])

  if (!hasMore) return null

  if (mode === "manual" || failedKey === loadKey) {
    return (
      <div className={cn("flex justify-center", className)}>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            requestedKeyRef.current = undefined
            setFailedKey(undefined)
            void request(loadKey)
          }}
        >
          {loading && <Loader2Icon className="animate-spin" aria-hidden />}
          {loading ? "Loading…" : failedKey === loadKey ? "Try again" : "Load more"}
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div ref={sentinelRef} className="h-px w-full" aria-hidden />

      {loading && (
        <div role="status" aria-live="polite" className="flex items-center py-2 text-xs text-muted-foreground">
          <Loader2Icon className="mr-2 size-3.5 animate-spin" aria-hidden />
          {loadingLabel}
        </div>
      )}
    </div>
  )
}
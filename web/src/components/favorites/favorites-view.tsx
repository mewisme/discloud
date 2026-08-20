"use client"

import { DownloadIcon, FileIcon, FolderIcon, HeartIcon, Loader2Icon, RefreshCwIcon, StarOffIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateTime } from "@/components/common/date-time"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { SearchPage, SearchQuery, SearchResult } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { setNodeFavorite } from "@/lib/files/favorite"
import { fileBrowserPath, folderBrowserPath } from "@/lib/files/navigation"
import { apiErrorMessage, formatBytes } from "@/lib/helpers"

export function FavoritesView() {
  const router = useRouter()
  const workspace = useWorkspace()
  const [results, setResults] = useState<SearchResult[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [retryKey, setRetryKey] = useState(0)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const moreController = useRef<AbortController>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setError(undefined)

      try {
        const page = await apiJSON<SearchPage>("/api/v1/search", {
          query: favoriteQuery(workspace.id),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setResults([...page.results])
        setNextCursor(page.nextCursor)
      } catch (cause) {
        if (controller.signal.aborted) return
        if (cause instanceof APIError && cause.status === 401) {
          router.replace("/login")
          router.refresh()
          return
        }
        setError(apiErrorMessage(cause, "Could not load favorites"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
      moreController.current?.abort()
    }
  }, [retryKey, router, workspace.id])

  async function loadMore() {
    if (!nextCursor || loadingMore) return

    const controller = new AbortController()
    moreController.current?.abort()
    moreController.current = controller
    setError(undefined)
    setLoadingMore(true)

    try {
      const page = await apiJSON<SearchPage>("/api/v1/search", {
        query: favoriteQuery(workspace.id, nextCursor),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setResults((current) => appendUnique(current, page.results))
      setNextCursor(page.nextCursor)
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }
      setError(apiErrorMessage(cause, "Could not load more favorites"))
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
    }
  }

  async function removeFavorite(result: SearchResult) {
    if (pendingIds.has(result.id)) return

    setPendingIds((current) => new Set(current).add(result.id))

    try {
      await setNodeFavorite(result.id, false)
      setResults((current) => current.filter((item) => item.id !== result.id))
      toast.success("Removed from favorites")
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }
      toast.error(apiErrorMessage(cause, "Could not remove from favorites"))
    } finally {
      setPendingIds((current) => {
        const next = new Set(current)
        next.delete(result.id)
        return next
      })
    }
  }

  function retry() {
    setError(undefined)
    setLoading(true)
    setRetryKey((current) => current + 1)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Favorites</h1>
        <p className="text-sm text-muted-foreground">Favorite files and folders in @{workspace.username}&apos;s workspace.</p>
      </div>

      {loading ? (
        <LoadingState />
      ) : error && results.length === 0 ? (
        <ErrorState error={error} onRetry={retry} />
      ) : results.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">Size</TableHead>
                  <TableHead className="hidden w-44 lg:table-cell">Modified</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {results.map((result) => (
                  <FavoriteRow key={result.id} result={result} pending={pendingIds.has(result.id)} onRemove={removeFavorite} />
                ))}
              </TableBody>
            </Table>
          </div>

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore && <Loader2Icon className="animate-spin" aria-hidden />}
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FavoriteRow({ result, pending, onRemove }: {
  result: SearchResult
  pending: boolean
  onRemove: (result: SearchResult) => Promise<void>
}) {
  const workspace = useWorkspace()
  const href = result.kind === "folder"
    ? folderBrowserPath(workspace.username, result.id)
    : fileBrowserPath(workspace.username, result.id)

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          {result.kind === "folder"
            ? <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            : <FileIcon className="size-4 shrink-0 text-muted-foreground" />}
          <Link href={href} className="truncate font-medium hover:underline">{result.name}</Link>
        </div>
      </TableCell>

      <TableCell className="hidden capitalize text-muted-foreground md:table-cell">
        {result.kind === "folder" ? "Folder" : result.category || "File"}
      </TableCell>

      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {result.size != null ? formatBytes(result.size) : "—"}
      </TableCell>

      <TableCell className="hidden text-muted-foreground lg:table-cell">
        <DateTime value={result.updatedAt} />
      </TableCell>

      <TableCell>
        <div className="flex justify-end gap-1">
          {result.kind === "file" && (
            <Button size="icon-sm" variant="ghost" asChild>
              <a href={`/api/backend/api/v1/files/${encodeURIComponent(result.id)}/download`} aria-label={`Download ${result.name}`} title="Download">
                <DownloadIcon />
              </a>
            </Button>
          )}

          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pending}
            aria-label={`Remove ${result.name} from favorites`}
            title="Remove from favorites"
            onClick={() => void onRemove(result)}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <StarOffIcon />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function LoadingState() {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border">
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        Loading favorites…
      </div>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-3">
        <div role="alert">
          <p className="font-medium">Favorites unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCwIcon />
          Try again
        </Button>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div>
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-muted">
          <HeartIcon className="size-5 text-muted-foreground" />
        </div>
        <p className="font-medium">No favorites yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Add files or folders to favorites from the File Browser.</p>
      </div>
    </div>
  )
}

function favoriteQuery(ownerId: string, cursor?: string): SearchQuery {
  return {
    ownerId,
    favorite: true,
    sort: "updated",
    order: "desc",
    limit: 50,
    cursor,
  }
}

function appendUnique(current: readonly SearchResult[], incoming: readonly SearchResult[]) {
  const ids = new Set(current.map((result) => result.id))
  return [...current, ...incoming.filter((result) => {
    if (ids.has(result.id)) return false
    ids.add(result.id)
    return true
  })]
}
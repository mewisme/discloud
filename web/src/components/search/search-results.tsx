"use client"

import type { SearchOptions } from "@discloud/shared/search"
import { Loader2Icon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { useWorkspace } from "@/components/app/workspace-context"
import { PaginationTrigger } from "@/components/common/pagination-trigger"
import { SearchResultRow } from "@/components/search/search-result-row"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { SearchPage, SearchQuery, SearchResult } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

export function SearchResults({ options }: { options: SearchOptions }) {
  const router = useRouter()
  const workspace = useWorkspace()
  const [results, setResults] = useState<SearchResult[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [retryKey, setRetryKey] = useState(0)
  const moreController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const page = await apiJSON<SearchPage>("/api/v1/search", {
          query: searchQuery(options, workspace.id),
          signal: controller.signal,
        })

        setResults([...page.results])
        setNextCursor(page.nextCursor)
      } catch (cause) {
        if (controller.signal.aborted) return

        if (cause instanceof APIError && cause.status === 401) {
          router.replace("/login")
          router.refresh()
          return
        }

        setError(apiErrorMessage(cause, "Could not search files"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
      moreController.current?.abort()
    }
  }, [options, retryKey, router, workspace.id])

  async function loadMore() {
    if (!nextCursor || loadingMore) return

    const controller = new AbortController()
    moreController.current?.abort()
    moreController.current = controller
    setError(undefined)
    setLoadingMore(true)

    try {
      const page = await apiJSON<SearchPage>("/api/v1/search", {
        query: searchQuery(options, workspace.id, nextCursor),
        signal: controller.signal,
      })

      setResults((current) => appendUniqueResults(current, page.results))
      setNextCursor(page.nextCursor)
    } catch (cause) {
      if (controller.signal.aborted) return

      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }

      setError(apiErrorMessage(cause, "Could not load more results"))
      throw cause
    } finally {
      if (moreController.current === controller) {
        moreController.current = null
        setLoadingMore(false)
      }
    }
  }

  function retry() {
    setError(undefined)
    setLoading(true)
    setRetryKey((current) => current + 1)
  }

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border">
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          Searching…
        </div>
      </div>
    )
  }

  if (error && results.length === 0) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
        <div className="space-y-3">
          <div role="alert">
            <p className="font-medium">Search unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>

          <Button size="sm" variant="outline" onClick={retry}>
            <RefreshCwIcon />
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
        <div>
          <SearchIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="font-medium">
            {options.q ? "No matching items" : "No files or folders found"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {options.q
              ? "Try a different query or remove some filters."
              : "Files and folders will appear here when available."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="sr-only" role="status" aria-live="polite">
        {results.length} result{results.length === 1 ? "" : "s"} loaded.
      </p>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden sm:table-cell">Access</TableHead>
              <TableHead className="hidden w-32 lg:table-cell">Size</TableHead>
              <TableHead className="hidden w-44 xl:table-cell">Modified</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {results.map((result) => (
              <SearchResultRow key={result.id} result={result} />
            ))}
          </TableBody>
        </Table>
      </div>

      {nextCursor && (
        <PaginationTrigger
          loadKey={nextCursor}
          hasMore
          loading={loadingMore}
          onLoadMore={loadMore}
          loadingLabel="Loading more results…"
        />
      )}
    </div>
  )
}

function searchQuery(
  options: SearchOptions,
  ownerId: string,
  cursor?: string,
): SearchQuery {
  return {
    q: options.q || undefined,
    ownerId,
    kind: options.kind === "all" ? undefined : options.kind,
    category: options.category === "all" ? undefined : options.category,
    favorite: options.favorite === "any" ? undefined : options.favorite === "true",
    shared: options.shared === "any" ? undefined : options.shared === "true",
    sort: options.sort,
    order: options.order,
    limit: 50,
    cursor,
  }
}

function appendUniqueResults(
  current: readonly SearchResult[],
  incoming: readonly SearchResult[],
) {
  const ids = new Set(current.map((result) => result.id))

  return [
    ...current,
    ...incoming.filter((result) => {
      if (ids.has(result.id)) return false
      ids.add(result.id)
      return true
    }),
  ]
}
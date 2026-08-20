"use client"

import { DownloadIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, HeartIcon, Loader2Icon, RefreshCwIcon, SearchIcon, Share2Icon, StarIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { DateTime } from "@/components/common/date-time"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { SearchPage, SearchQuery, SearchResult } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage, formatBytes } from "@/lib/helpers"
import { defaultSearchOrder, parseSearchOptions, patchSearchOptions, type SearchCategory, type SearchFlag, type SearchKind, type SearchOptions, type SearchSort, searchURL } from "@/lib/search/options"

export function SearchView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryKey = searchParams.toString()
  const options = useMemo(() => parseSearchOptions(new URLSearchParams(queryKey)), [queryKey])

  const replaceOptions = useCallback((patch: Partial<SearchOptions>) => {
    router.replace(searchURL(patchSearchOptions(options, patch)), { scroll: false })
  }, [options, router])

  function changeSort(sort: SearchSort) {
    replaceOptions({ sort, order: defaultSearchOrder(sort) })
  }

  function reset() {
    router.replace("/search", { scroll: false })
  }

  const filtered = options.kind !== "all" || options.category !== "all" || options.favorite !== "any" || options.shared !== "any"

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">Search files and folders you have access to.</p>
      </div>

      <SearchInput key={`search-input:${options.q}`} initialValue={options.q} onChange={(q) => replaceOptions({ q })} />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={options.kind} onValueChange={(value) => replaceOptions({ kind: value as SearchKind })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Type</SelectLabel>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="file">Files</SelectItem>
              <SelectItem value="folder">Folders</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.category} onValueChange={(value) => replaceOptions({ category: value as SearchCategory })}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Category</SelectLabel>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="image">Images</SelectItem>
              <SelectItem value="video">Videos</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
              <SelectItem value="document">Documents</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="archive">Archives</SelectItem>
              <SelectItem value="application">Applications</SelectItem>
              <SelectItem value="binary">Binary</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.favorite} onValueChange={(value) => replaceOptions({ favorite: value as SearchFlag })}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by favorite status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Favorite status</SelectLabel>
              <SelectItem value="any">Any favorite</SelectItem>
              <SelectItem value="true">Favorites</SelectItem>
              <SelectItem value="false">Not favorite</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.shared} onValueChange={(value) => replaceOptions({ shared: value as SearchFlag })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by sharing status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Sharing</SelectLabel>
              <SelectItem value="any">Any sharing</SelectItem>
              <SelectItem value="true">Shared</SelectItem>
              <SelectItem value="false">Not shared</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.sort} onValueChange={(value) => changeSort(value as SearchSort)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Sort search results by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Sort by</SelectLabel>
              {options.q && <SelectItem value="relevance">Relevance</SelectItem>}
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="updated">Modified</SelectItem>
              <SelectItem value="size">Size</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.order} onValueChange={(value) => replaceOptions({ order: value as "asc" | "desc" })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Sort direction">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Direction</SelectLabel>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        {(options.q || filtered) && (
          <Button size="sm" variant="ghost" onClick={reset}>
            <XIcon />
            Clear
          </Button>
        )}
      </div>

      <SearchResults key={`search-results:${queryKey}`} options={options} />
    </div>
  )
}

function SearchInput({ initialValue, onChange }: { initialValue: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (value.trim() === initialValue) return
    const timeout = setTimeout(() => onChange(value.trim()), 300)
    return () => clearTimeout(timeout)
  }, [initialValue, onChange, value])

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} maxLength={256} autoFocus aria-label="Search files and folders" placeholder="Search files and folders…" className="h-11 pl-9" onChange={(event) => setValue(event.target.value)} />
    </div>
  )
}

function SearchResults({ options }: { options: SearchOptions }) {
  const router = useRouter()
  const [results, setResults] = useState<SearchResult[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [retryKey, setRetryKey] = useState(0)
  const moreController = useRef<AbortController>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery(options), signal: controller.signal })
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
  }, [options, retryKey, router])

  async function loadMore() {
    if (!nextCursor || loadingMore) return

    const controller = new AbortController()
    moreController.current?.abort()
    moreController.current = controller
    setError(undefined)
    setLoadingMore(true)

    try {
      const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery(options, nextCursor), signal: controller.signal })
      setResults((current) => [...current, ...page.results])
      setNextCursor(page.nextCursor)
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }
      setError(apiErrorMessage(cause, "Could not load more results"))
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
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
          <p className="font-medium">{options.q ? "No matching items" : "No accessible items"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {options.q ? "Try a different query or remove some filters." : "Files and folders will appear here when available."}
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
            {results.map((result) => <SearchResultRow key={`${result.id}:${result.collectionId ?? ""}`} result={result} />)}
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
  )
}

function SearchResultRow({ result }: { result: SearchResult }) {
  const href = resultHref(result)
  const collectionOnly = result.kind === "file" && !result.parentId && !!result.collectionId

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <ResultIcon result={result} />
          {href ? (
            <Link href={href} className="truncate font-medium hover:underline">
              {result.name}
            </Link>
          ) : (
            <span className="truncate font-medium">{result.name}</span>
          )}
          {result.isFavorite && <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" />}
        </div>
      </TableCell>

      <TableCell className="hidden capitalize text-muted-foreground md:table-cell">
        {result.kind === "folder" ? "Folder" : result.category || "File"}
      </TableCell>

      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {collectionOnly
            ? <><FileIcon className="size-3.5" />Collection</>
            : result.shared
              ? <><Share2Icon className="size-3.5" />Shared</>
              : result.isFavorite
                ? <><HeartIcon className="size-3.5" />Favorite</>
                : "Accessible"}
        </div>
      </TableCell>

      <TableCell className="hidden text-muted-foreground lg:table-cell">
        {result.size != null ? formatBytes(result.size) : "—"}
      </TableCell>

      <TableCell className="hidden text-muted-foreground xl:table-cell">
        <DateTime value={result.updatedAt} />
      </TableCell>

      <TableCell>
        {result.kind === "file" && (
          <Button size="icon-sm" variant="ghost" asChild>
            <a href={downloadURL(result)} aria-label={`Download ${result.name}`}>
              <DownloadIcon />
            </a>
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

function ResultIcon({ result }: { result: SearchResult }) {
  if (result.kind === "folder") return <FolderIcon className="size-4 shrink-0" />

  switch (result.category) {
    case "image":
      return <FileImageIcon className="size-4 shrink-0" />
    case "video":
      return <FileVideoIcon className="size-4 shrink-0" />
    case "audio":
      return <FileAudioIcon className="size-4 shrink-0" />
    case "document":
    case "text":
      return <FileTextIcon className="size-4 shrink-0" />
    case "archive":
      return <FileArchiveIcon className="size-4 shrink-0" />
    default:
      return <FileIcon className="size-4 shrink-0" />
  }
}

function resultHref(result: SearchResult) {
  if (result.kind === "folder") return `/files/${result.id}`
  if (result.collectionId) return `/collections/${encodeURIComponent(result.collectionId)}/files/${encodeURIComponent(result.id)}`
  if (result.parentId) return `/files/file/${result.id}`
  return undefined
}

function downloadURL(result: SearchResult) {
  const base = `/api/backend/api/v1/files/${encodeURIComponent(result.id)}/download`
  return result.collectionId ? `${base}?collectionId=${encodeURIComponent(result.collectionId)}` : base
}

function searchQuery(options: SearchOptions, cursor?: string): SearchQuery {
  return {
    q: options.q || undefined,
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
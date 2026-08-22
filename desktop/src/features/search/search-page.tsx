import type { SearchPage, SearchQuery, WorkspaceDetails } from "@discloud/api/models"
import { defaultSearchOrder, parseSearchOptions, patchSearchOptions, type SearchCategory, type SearchFlag, type SearchKind, type SearchOptions, searchParamsForOptions, type SearchSort } from "@discloud/shared/search"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Loader2Icon, RefreshCwIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"
import { DesktopSearchResultsTable } from "./search-results-table"

type WorkspaceState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails }
type ResultsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; page: SearchPage }

export function DesktopSearchPage() {
  const { username } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryKey = searchParams.toString()
  const options = useMemo(() => parseSearchOptions(new URLSearchParams(queryKey)), [queryKey])
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ status: "loading" })
  const [resultsState, setResultsState] = useState<ResultsState>({ status: "loading" })
  const [loadingMore, setLoadingMore] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!username) {
        setWorkspaceState({ status: "error", message: "Workspace username is missing." })
        return
      }

      setWorkspaceState({ status: "loading" })

      try {
        const workspace = await loadDesktopWorkspace(username)
        if (!cancelled) setWorkspaceState({ status: "ready", workspace })
      } catch (error) {
        if (!cancelled) setWorkspaceState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [username])

  useEffect(() => {
    if (workspaceState.status !== "ready") return

    const workspace = workspaceState.workspace
    let cancelled = false

    async function load() {
      setResultsState({ status: "loading" })

      try {
        const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery(options, workspace.owner.id) })
        if (!cancelled) setResultsState({ status: "ready", page })
      } catch (error) {
        if (!cancelled) setResultsState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [workspaceState, queryKey, retryVersion])

  const replaceOptions = useCallback((patch: Partial<SearchOptions>) => {
    setSearchParams(searchParamsForOptions(patchSearchOptions(options, patch)), { replace: true })
  }, [options, setSearchParams])

  async function loadMore() {
    if (workspaceState.status !== "ready" || resultsState.status !== "ready" || !resultsState.page.nextCursor || loadingMore) return

    setLoadingMore(true)

    try {
      const page = await apiJSON<SearchPage>("/api/v1/search", {
        query: searchQuery(options, workspaceState.workspace.owner.id, resultsState.page.nextCursor),
      })

      setResultsState((current) => current.status === "ready"
        ? { status: "ready", page: { ...page, results: appendUnique(current.page.results, page.results) } }
        : current)
    } catch (error) {
      setResultsState({ status: "error", message: errorMessage(error) })
    } finally {
      setLoadingMore(false)
    }
  }

  if (workspaceState.status === "loading") return <Loading label="Loading workspace" />
  if (workspaceState.status === "error") return <ErrorState message={workspaceState.message} />

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">Search files and folders in @{workspaceState.workspace.owner.username}&apos;s workspace.</p>
      </div>

      <SearchBox initialValue={options.q} onChange={(q) => replaceOptions({ q })} />
      <SearchFilters
        options={options}
        onChange={replaceOptions}
        onSortChange={(sort) => replaceOptions({ sort, order: defaultSearchOrder(sort) })}
        onReset={() => setSearchParams(new URLSearchParams(), { replace: true })}
      />

      {resultsState.status === "loading" ? (
        <Loading label="Searching…" />
      ) : resultsState.status === "error" ? (
        <ErrorState message={resultsState.message} onRetry={() => setRetryVersion((value) => value + 1)} />
      ) : resultsState.page.results.length === 0 ? (
        <EmptySearch query={options.q} />
      ) : (
        <>
          <DesktopSearchResultsTable username={workspaceState.workspace.owner.username} results={resultsState.page.results} />

          {resultsState.page.nextCursor ? (
            <div className="flex justify-center">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? <Loader2Icon className="animate-spin" /> : null}
                {loadingMore ? "Loading" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function SearchBox({ initialValue, onChange }: { initialValue: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

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

function SearchFilters({ options, onChange, onSortChange, onReset }: { options: SearchOptions; onChange: (patch: Partial<SearchOptions>) => void; onSortChange: (sort: SearchSort) => void; onReset: () => void }) {
  const filtered = options.kind !== "all" || options.category !== "all" || options.favorite !== "any" || options.shared !== "any"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={options.kind} onValueChange={(value) => onChange({ kind: value as SearchKind })}>
        <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Type</SelectLabel>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="file">Files</SelectItem>
            <SelectItem value="folder">Folders</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select value={options.category} onValueChange={(value) => onChange({ category: value as SearchCategory })}>
        <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Category</SelectLabel>
            {["all", "image", "video", "audio", "document", "text", "archive", "application", "binary", "other"].map((value) => (
              <SelectItem key={value} value={value}>{value === "all" ? "All categories" : value.charAt(0).toUpperCase() + value.slice(1)}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select value={options.favorite} onValueChange={(value) => onChange({ favorite: value as SearchFlag })}>
        <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any favorite</SelectItem>
          <SelectItem value="true">Favorites</SelectItem>
          <SelectItem value="false">Not favorite</SelectItem>
        </SelectContent>
      </Select>

      <Select value={options.shared} onValueChange={(value) => onChange({ shared: value as SearchFlag })}>
        <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any sharing</SelectItem>
          <SelectItem value="true">Shared</SelectItem>
          <SelectItem value="false">Not shared</SelectItem>
        </SelectContent>
      </Select>

      <Select value={options.sort} onValueChange={(value) => onSortChange(value as SearchSort)}>
        <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.q ? <SelectItem value="relevance">Relevance</SelectItem> : null}
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="created">Created</SelectItem>
          <SelectItem value="updated">Modified</SelectItem>
          <SelectItem value="size">Size</SelectItem>
        </SelectContent>
      </Select>

      <Select value={options.order} onValueChange={(value) => onChange({ order: value as SearchOptions["order"] })}>
        <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="asc">Ascending</SelectItem>
          <SelectItem value="desc">Descending</SelectItem>
        </SelectContent>
      </Select>

      {options.q || filtered ? (
        <Button size="sm" variant="ghost" onClick={onReset}>
          <XIcon />
          Clear
        </Button>
      ) : null}
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="animate-spin" />
        {label}
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Search unavailable</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message}</p>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCwIcon />
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function EmptySearch({ query }: { query: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div>
        <SearchIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
        <p className="font-medium">{query ? "No matching items" : "No files or folders found"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{query ? "Try a different query or remove some filters." : "Files and folders will appear here when available."}</p>
      </div>
    </div>
  )
}

function searchQuery(options: SearchOptions, ownerId: string, cursor?: string): SearchQuery {
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

function appendUnique(current: readonly SearchPage["results"][number][], incoming: readonly SearchPage["results"][number][]) {
  const ids = new Set(current.map((result) => result.id))
  return [...current, ...incoming.filter((result) => !ids.has(result.id) && !!ids.add(result.id))]
}
import type { SearchPage, SearchQuery, WorkspaceDetails } from "@discloud/api/models"
import { SearchFilters } from "@discloud/app-ui/search/search-filters"
import { defaultSearchOrder, parseSearchOptions, patchSearchOptions, type SearchOptions, searchParamsForOptions, searchRequestQuery } from "@discloud/shared/search"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { Input } from "@discloud/ui/components/input"
import { Loader2Icon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router"

import { useDesktopSession } from "#components/desktop-session"
import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"
import { DesktopSearchResultsTable } from "./search-results-table"

type WorkspaceState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails }
type ResultsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; page: SearchPage }

export function DesktopSearchPage() {
  const { username } = useParams()
  const { state: session } = useDesktopSession()
  const admin = session.status === "connected" && session.user?.role === "admin"
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
        const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery(options, workspace.owner.id, admin) })
        if (!cancelled) setResultsState({ status: "ready", page })
      } catch (error) {
        if (!cancelled) setResultsState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [admin, workspaceState, queryKey, retryVersion])

  const replaceOptions = useCallback((patch: Partial<SearchOptions>) => {
    setSearchParams(searchParamsForOptions(patchSearchOptions(options, patch)), { replace: true })
  }, [options, setSearchParams])

  async function loadMore() {
    if (workspaceState.status !== "ready" || resultsState.status !== "ready" || !resultsState.page.nextCursor || loadingMore) return

    setLoadingMore(true)
    try {
      const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery(options, workspaceState.workspace.owner.id, admin, resultsState.page.nextCursor) })
      setResultsState((current) => current.status === "ready" ? { status: "ready", page: { ...page, results: appendUnique(current.page.results, page.results) } } : current)
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
        admin={admin}
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

  useEffect(() => setValue(initialValue), [initialValue])
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

function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" />{label}</div>
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
        {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}><RefreshCwIcon />Try again</Button> : null}
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

function searchQuery(options: SearchOptions, ownerId: string, admin: boolean, cursor?: string): SearchQuery {
  return { ...searchRequestQuery(options, admin), ownerId, limit: 50, cursor }
}

function appendUnique(current: readonly SearchPage["results"][number][], incoming: readonly SearchPage["results"][number][]) {
  const ids = new Set(current.map((result) => result.id))
  return [...current, ...incoming.filter((result) => !ids.has(result.id) && !!ids.add(result.id))]
}

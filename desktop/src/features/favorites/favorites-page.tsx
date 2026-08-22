import type { SearchPage, SearchQuery, SearchResult, WorkspaceDetails } from "@discloud/api/models"
import { Button } from "@discloud/ui/components/button"
import { HeartIcon, Loader2Icon, RefreshCwIcon, StarOffIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { DesktopSearchResultsTable } from "../search/search-results-table"
import { loadDesktopWorkspace } from "../workspace/api"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails; page: SearchPage }

export function DesktopFavoritesPage() {
  const { username } = useParams()
  const [state, setState] = useState<State>({ status: "loading" })
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [actionError, setActionError] = useState<string>()
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!username) {
        setState({ status: "error", message: "Workspace username is missing." })
        return
      }

      setState({ status: "loading" })

      try {
        const workspace = await loadDesktopWorkspace(username)
        const page = await apiJSON<SearchPage>("/api/v1/search", { query: favoriteQuery(workspace.owner.id) })
        if (!cancelled) setState({ status: "ready", workspace, page })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [username, retryVersion])

  async function loadMore() {
    if (state.status !== "ready" || !state.page.nextCursor || loadingMore) return

    setLoadingMore(true)
    setActionError(undefined)

    try {
      const page = await apiJSON<SearchPage>("/api/v1/search", { query: favoriteQuery(state.workspace.owner.id, state.page.nextCursor) })
      setState((current) => current.status === "ready"
        ? { ...current, page: { ...page, results: appendUnique(current.page.results, page.results) } }
        : current)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setLoadingMore(false)
    }
  }

  async function remove(result: SearchResult) {
    if (pending.has(result.id)) return

    setPending((current) => new Set(current).add(result.id))
    setActionError(undefined)

    try {
      await apiJSON(`/api/v1/nodes/${encodeURIComponent(result.id)}/favorite`, { method: "DELETE" })
      setState((current) => current.status === "ready"
        ? { ...current, page: { ...current.page, results: current.page.results.filter((item) => item.id !== result.id) } }
        : current)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(result.id)
        return next
      })
    }
  }

  if (state.status === "loading") return <Loading />
  if (state.status === "error") return <ErrorState message={state.message} onRetry={() => setRetryVersion((value) => value + 1)} />

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Favorites</h1>
        <p className="text-sm text-muted-foreground">Favorite files and folders in @{state.workspace.owner.username}&apos;s workspace.</p>
      </div>

      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

      {state.page.results.length === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <HeartIcon className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">No favorites yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add files or folders to favorites from the File Browser.</p>
          </div>
        </div>
      ) : (
        <>
          <DesktopSearchResultsTable
            username={state.workspace.owner.username}
            results={state.page.results}
            renderActions={(result) => (
              <Button size="icon-sm" variant="ghost" disabled={pending.has(result.id)} aria-label={`Remove ${result.name} from favorites`} title="Remove from favorites" onClick={() => void remove(result)}>
                {pending.has(result.id) ? <Loader2Icon className="animate-spin" /> : <StarOffIcon />}
              </Button>
            )}
          />

          {state.page.nextCursor ? (
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

function Loading() {
  return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-3">
        <TriangleAlertIcon className="mx-auto size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}><RefreshCwIcon />Try again</Button>
      </div>
    </div>
  )
}

function favoriteQuery(ownerId: string, cursor?: string): SearchQuery {
  return { ownerId, favorite: true, sort: "updated", order: "desc", limit: 50, cursor }
}

function appendUnique(current: readonly SearchResult[], incoming: readonly SearchResult[]) {
  const ids = new Set(current.map((result) => result.id))
  return [...current, ...incoming.filter((result) => !ids.has(result.id) && !!ids.add(result.id))]
}
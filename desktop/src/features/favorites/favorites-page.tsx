import type { SearchPage, SearchQuery, SearchResult, WorkspaceDetails } from "@discloud/api/models"
import { FavoritesView } from "@discloud/app-ui/favorites/favorites-view"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, StarOffIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { DesktopPaginationTrigger } from "#components/pagination-trigger"
import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { DesktopSearchResultsTable } from "../search/search-results-table"
import { loadDesktopWorkspace } from "../workspace/api"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails; page: SearchPage }
export function DesktopFavoritesPage() {
  const { username } = useParams(); const [state, setState] = useState<State>({ status: "loading" }); const [loadingMore, setLoadingMore] = useState(false); const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set()); const [actionError, setActionError] = useState<string>(); const [retryVersion, setRetryVersion] = useState(0)
  useEffect(() => { let cancelled = false; async function load() { if (!username) { setState({ status: "error", message: "Workspace username is missing." }); return } setState({ status: "loading" }); try { const workspace = await loadDesktopWorkspace(username); const page = await apiJSON<SearchPage>("/api/v1/search", { query: favoriteQuery(workspace.owner.id) }); if (!cancelled) setState({ status: "ready", workspace, page }) } catch (error) { if (!cancelled) setState({ status: "error", message: errorMessage(error) }) } } void load(); return () => { cancelled = true } }, [username, retryVersion])
  async function loadMore() { if (state.status !== "ready" || !state.page.nextCursor || loadingMore) return; setLoadingMore(true); setActionError(undefined); try { const page = await apiJSON<SearchPage>("/api/v1/search", { query: favoriteQuery(state.workspace.owner.id, state.page.nextCursor) }); setState((current) => current.status === "ready" ? { ...current, page: { ...page, results: appendUnique(current.page.results, page.results) } } : current) } catch (error) { setActionError(errorMessage(error)); throw error } finally { setLoadingMore(false) } }
  async function remove(result: SearchResult) { if (pending.has(result.id)) return; setPending((current) => new Set(current).add(result.id)); setActionError(undefined); try { await apiJSON(`/api/v1/nodes/${encodeURIComponent(result.id)}/favorite`, { method: "DELETE" }); setState((current) => current.status === "ready" ? { ...current, page: { ...current.page, results: current.page.results.filter((item) => item.id !== result.id) } } : current) } catch (error) { setActionError(errorMessage(error)) } finally { setPending((current) => { const next = new Set(current); next.delete(result.id); return next }) } }
  if (state.status === "loading") return <FavoritesView count={0} loading />
  if (state.status === "error") return <FavoritesView username={username} count={0} error={state.message} onRetry={() => setRetryVersion((value) => value + 1)} />
  const results = state.page.results
  return <FavoritesView username={state.workspace.owner.username} count={results.length} error={actionError} results={<DesktopSearchResultsTable username={state.workspace.owner.username} results={results} renderActions={(result) => <Button size="icon-sm" variant="ghost" disabled={pending.has(result.id)} aria-label={`Remove ${result.name} from favorites`} title="Remove from favorites" onClick={() => void remove(result)}>{pending.has(result.id) ? <Loader2Icon className="animate-spin" /> : <StarOffIcon />}</Button>} />} pagination={state.page.nextCursor ? <DesktopPaginationTrigger loadKey={state.page.nextCursor} hasMore loading={loadingMore} onLoadMore={loadMore} loadingLabel="Loading more favorites…" /> : null} />
}
function favoriteQuery(ownerId: string, cursor?: string): SearchQuery { return { ownerId, favorite: true, sort: "updated", order: "desc", limit: 50, cursor } }
function appendUnique(current: readonly SearchResult[], incoming: readonly SearchResult[]) { const ids = new Set(current.map((result) => result.id)); return [...current, ...incoming.filter((result) => !ids.has(result.id) && !!ids.add(result.id))] }

"use client"

import { FavoritesView as FavoritesPresentation } from "@discloud/app-ui/favorites/favorites-view"
import { SearchResultsTable } from "@discloud/app-ui/search/search-results-table"
import { Button } from "@discloud/ui/components/button"
import { DownloadIcon, Loader2Icon, StarOffIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateTime } from "@/components/common/date-time"
import { PaginationTrigger } from "@/components/common/pagination-trigger"
import { apiJSON } from "@/lib/api/client"
import type { SearchPage, SearchQuery, SearchResult } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { setNodeFavorite } from "@/lib/files/favorite"
import { fileBrowserPath, folderBrowserPath } from "@/lib/files/navigation"
import { apiErrorMessage } from "@/lib/helpers"

export function FavoritesView() {
  const router = useRouter(); const workspace = useWorkspace(); const [results, setResults] = useState<SearchResult[]>([]); const [nextCursor, setNextCursor] = useState<string>(); const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState<string>(); const [retryKey, setRetryKey] = useState(0); const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set()); const moreController = useRef<AbortController>(null)
  useEffect(() => { const controller = new AbortController(); async function load() { setError(undefined); try { const page = await apiJSON<SearchPage>("/api/v1/search", { query: favoriteQuery(workspace.id), signal: controller.signal }); if (controller.signal.aborted) return; setResults([...page.results]); setNextCursor(page.nextCursor) } catch (cause) { if (controller.signal.aborted) return; if (cause instanceof APIError && cause.status === 401) { router.replace("/login"); router.refresh(); return } setError(apiErrorMessage(cause, "Could not load favorites")) } finally { if (!controller.signal.aborted) setLoading(false) } } void load(); return () => { controller.abort(); moreController.current?.abort() } }, [retryKey, router, workspace.id])
  async function loadMore() { if (!nextCursor || loadingMore) return; const controller = new AbortController(); moreController.current?.abort(); moreController.current = controller; setError(undefined); setLoadingMore(true); try { const page = await apiJSON<SearchPage>("/api/v1/search", { query: favoriteQuery(workspace.id, nextCursor), signal: controller.signal }); if (controller.signal.aborted) return; setResults((current) => appendUnique(current, page.results)); setNextCursor(page.nextCursor) } catch (cause) { if (controller.signal.aborted) return; if (cause instanceof APIError && cause.status === 401) { router.replace("/login"); router.refresh(); return } setError(apiErrorMessage(cause, "Could not load more favorites")); throw cause } finally { if (!controller.signal.aborted) setLoadingMore(false) } }
  async function removeFavorite(result: SearchResult) { if (pendingIds.has(result.id)) return; setPendingIds((current) => new Set(current).add(result.id)); try { await setNodeFavorite(result.id, false); setResults((current) => current.filter((item) => item.id !== result.id)); toast.success("Removed from favorites") } catch (cause) { if (cause instanceof APIError && cause.status === 401) { router.replace("/login"); router.refresh(); return } toast.error(apiErrorMessage(cause, "Could not remove from favorites")) } finally { setPendingIds((current) => { const next = new Set(current); next.delete(result.id); return next }) } }
  function retry() { setError(undefined); setLoading(true); setRetryKey((current) => current + 1) }
  return <FavoritesPresentation username={workspace.username} count={results.length} loading={loading} error={error} onRetry={retry} results={<SearchResultsTable results={results} showAccess={false} renderLink={(result, className, children) => <Link href={resultHref(workspace.username, result)} className={className}>{children}</Link>} renderModified={(result) => <DateTime value={result.updatedAt} />} renderActions={(result) => <>{result.kind === "file" ? <Button size="icon-sm" variant="ghost" asChild><a href={`/api/backend/api/v1/files/${encodeURIComponent(result.id)}/download`} aria-label={`Download ${result.name}`} title="Download"><DownloadIcon /></a></Button> : null}<Button size="icon-sm" variant="ghost" disabled={pendingIds.has(result.id)} aria-label={`Remove ${result.name} from favorites`} title="Remove from favorites" onClick={() => void removeFavorite(result)}>{pendingIds.has(result.id) ? <Loader2Icon className="animate-spin" /> : <StarOffIcon />}</Button></>} />} pagination={nextCursor ? <PaginationTrigger loadKey={nextCursor} hasMore loading={loadingMore} onLoadMore={loadMore} loadingLabel="Loading more favorites…" /> : null} />
}
function resultHref(username: string, result: SearchResult) { return result.kind === "folder" ? folderBrowserPath(username, result.id) : fileBrowserPath(username, result.id) }
function favoriteQuery(ownerId: string, cursor?: string): SearchQuery { return { ownerId, favorite: true, sort: "updated", order: "desc", limit: 50, cursor } }
function appendUnique(current: readonly SearchResult[], incoming: readonly SearchResult[]) { const ids = new Set(current.map((result) => result.id)); return [...current, ...incoming.filter((result) => { if (ids.has(result.id)) return false; ids.add(result.id); return true })] }

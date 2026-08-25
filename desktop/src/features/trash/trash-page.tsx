import type { Node, TrashItem, TrashPage, TrashQuery, WorkspaceDetails } from "@discloud/api/models"
import { TrashView } from "@discloud/app-ui/trash/trash-view"
import { Loader2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { DesktopPaginationTrigger } from "#components/pagination-trigger"
import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails; page: TrashPage }
export function DesktopTrashPage() {
  const { username } = useParams(); const [state, setState] = useState<State>({ status: "loading" }); const [loadingMore, setLoadingMore] = useState(false); const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set()); const [actionError, setActionError] = useState<string>()
  useEffect(() => { let cancelled = false; async function load() { if (!username) { setState({ status: "error", message: "Workspace username is missing." }); return } try { const workspace = await loadDesktopWorkspace(username); const page = await apiJSON<TrashPage>("/api/v1/trash", { query: trashQuery(workspace.owner.id) }); if (!cancelled) setState({ status: "ready", workspace, page }) } catch (error) { if (!cancelled) setState({ status: "error", message: errorMessage(error) }) } } void load(); return () => { cancelled = true } }, [username])
  function setItemPending(id: string, value: boolean) { setPending((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next }) }
  async function loadMore() { if (state.status !== "ready" || !state.page.nextCursor || loadingMore) return; setLoadingMore(true); setActionError(undefined); try { const page = await apiJSON<TrashPage>("/api/v1/trash", { query: trashQuery(state.workspace.owner.id, state.page.nextCursor) }); setState((current) => current.status === "ready" ? { ...current, page: { ...page, items: [...current.page.items, ...page.items] } } : current) } catch (error) { setActionError(errorMessage(error)); throw error } finally { setLoadingMore(false) } }
  async function restore(item: TrashItem) { if (pending.has(item.node.id)) return; setItemPending(item.node.id, true); setActionError(undefined); try { await apiJSON<Node>(restorePath(item), { method: "POST" }); removeItem(item.node.id) } catch (error) { setActionError(errorMessage(error)) } finally { setItemPending(item.node.id, false) } }
  async function deleteForever(item: TrashItem) { if (pending.has(item.node.id)) return false; setItemPending(item.node.id, true); setActionError(undefined); try { await apiJSON<void>(permanentPath(item), { method: "DELETE" }); removeItem(item.node.id); return true } catch (error) { setActionError(errorMessage(error)); return false } finally { setItemPending(item.node.id, false) } }
  function removeItem(id: string) { setState((current) => current.status === "ready" ? { ...current, page: { ...current.page, items: current.page.items.filter((item) => item.node.id !== id) } } : current) }
  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
  if (state.status === "error") return <p role="alert" className="text-sm text-destructive">{state.message}</p>
  return <TrashView username={state.workspace.owner.username} items={state.page.items} pending={pending} actionError={actionError} onRestore={restore} onDeleteForever={deleteForever} pagination={state.page.nextCursor ? <DesktopPaginationTrigger loadKey={state.page.nextCursor} hasMore loading={loadingMore} onLoadMore={loadMore} className="p-3" loadingLabel="Loading more trash items…" /> : null} />
}
function trashQuery(ownerId: string, cursor?: string): TrashQuery { return { ownerId, limit: 50, cursor } }
function restorePath(item: TrashItem) { const id = encodeURIComponent(item.node.id); return item.node.kind === "folder" ? `/api/v1/folders/${id}/restore` : `/api/v1/files/${id}/restore` }
function permanentPath(item: TrashItem) { const id = encodeURIComponent(item.node.id); return item.node.kind === "folder" ? `/api/v1/folders/${id}/permanent` : `/api/v1/files/${id}/permanent` }

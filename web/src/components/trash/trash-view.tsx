"use client"

import { TrashView as TrashPresentation } from "@discloud/app-ui/trash/trash-view"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateOnly } from "@/components/common/date-time"
import { PaginationTrigger } from "@/components/common/pagination-trigger"
import { apiJSON } from "@/lib/api/client"
import type { Node, TrashItem, TrashPage, TrashQuery } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

const pageSize = 50
export function TrashView({ initialPage }: { initialPage: TrashPage }) {
  const router = useRouter(); const workspace = useWorkspace(); const [items, setItems] = useState<TrashItem[]>(() => [...initialPage.items]); const [nextCursor, setNextCursor] = useState(initialPage.nextCursor); const [loading, setLoading] = useState(false); const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  function setItemPending(id: string, value: boolean) { setPending((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next }) }
  async function loadMore() { if (!nextCursor || loading) return; setLoading(true); try { const query = { ownerId: workspace.id, limit: pageSize, cursor: nextCursor } satisfies TrashQuery; const page = await apiJSON<TrashPage>("/api/v1/trash", { query }); setItems((current) => [...current, ...page.items]); setNextCursor(page.nextCursor) } catch (error) { toast.error(apiErrorMessage(error, "Could not load more trash items.")); throw error } finally { setLoading(false) } }
  async function restore(item: TrashItem) { const id = item.node.id; if (pending.has(id)) return; setItemPending(id, true); try { await apiJSON<Node>(restorePath(item), { method: "POST" }); setItems((current) => current.filter((candidate) => candidate.node.id !== id)); toast.success(`${item.node.name} restored`); router.refresh() } catch (error) { toast.error(apiErrorMessage(error, "Could not restore this item.")) } finally { setItemPending(id, false) } }
  async function deleteForever(item: TrashItem) { const id = item.node.id; if (pending.has(id)) return false; setItemPending(id, true); try { await apiJSON<void>(permanentPath(item), { method: "DELETE" }); setItems((current) => current.filter((candidate) => candidate.node.id !== id)); toast.success(`${item.node.name} permanently deleted`); router.refresh(); return true } catch (error) { toast.error(apiErrorMessage(error, "Could not permanently delete this item.")); return false } finally { setItemPending(id, false) } }
  return <TrashPresentation username={workspace.username} items={items} pending={pending} onRestore={restore} onDeleteForever={deleteForever} renderDeletedAt={(item) => <DateOnly value={item.deletedAt} />} pagination={nextCursor ? <PaginationTrigger loadKey={nextCursor} hasMore loading={loading} onLoadMore={loadMore} className="p-3" loadingLabel="Loading more trash items…" /> : null} />
}
function restorePath(item: TrashItem) { const id = encodeURIComponent(item.node.id); return item.node.kind === "folder" ? `/api/v1/folders/${id}/restore` : `/api/v1/files/${id}/restore` }
function permanentPath(item: TrashItem) { const id = encodeURIComponent(item.node.id); return item.node.kind === "folder" ? `/api/v1/folders/${id}/permanent` : `/api/v1/files/${id}/permanent` }

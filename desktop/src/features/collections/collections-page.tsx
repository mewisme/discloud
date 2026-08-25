import type { Collection, CollectionPage, CollectionsQuery, CreateCollectionInput, WorkspaceDetails } from "@discloud/api/models"
import { CollectionsView } from "@discloud/app-ui/collections/collections-view"
import { workspaceCollectionPath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Textarea } from "@discloud/ui/components/textarea"
import { Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { DesktopPaginationTrigger } from "#components/pagination-trigger"
import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails; page: CollectionPage }

export function DesktopCollectionsPage() {
  const { username } = useParams(); const [state, setState] = useState<State>({ status: "loading" }); const [loadingMore, setLoadingMore] = useState(false); const [retryVersion, setRetryVersion] = useState(0)
  useEffect(() => { let cancelled = false; async function load() { if (!username) { setState({ status: "error", message: "Workspace username is missing." }); return } setState({ status: "loading" }); try { const workspace = await loadDesktopWorkspace(username); const page = await apiJSON<CollectionPage>("/api/v1/collections", { query: collectionQuery(workspace.owner.id) }); if (!cancelled) setState({ status: "ready", workspace, page }) } catch (error) { if (!cancelled) setState({ status: "error", message: errorMessage(error) }) } } void load(); return () => { cancelled = true } }, [username, retryVersion])
  async function loadMore() { if (state.status !== "ready" || !state.page.nextCursor || loadingMore) return; setLoadingMore(true); try { const page = await apiJSON<CollectionPage>("/api/v1/collections", { query: collectionQuery(state.workspace.owner.id, state.page.nextCursor) }); setState((current) => current.status === "ready" ? { ...current, page: { ...page, collections: appendUnique(current.page.collections, page.collections) } } : current) } finally { setLoadingMore(false) } }
  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
  if (state.status === "error") return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><p className="text-sm text-muted-foreground">{state.message}</p><Button size="sm" variant="outline" onClick={() => setRetryVersion((value) => value + 1)}><RefreshCwIcon />Try again</Button></div></div>
  function created(collection: Collection) { setState((current) => current.status === "ready" ? { ...current, page: { ...current.page, collections: [...current.page.collections, collection].sort((a, b) => a.name.localeCompare(b.name)) } } : current) }
  const owner = state.workspace.owner
  return <CollectionsView username={owner.username} collections={state.page.collections} action={<CreateCollectionDialog workspace={state.workspace} onCreated={created} />} renderLink={(collection, className, children) => <Link to={workspaceCollectionPath(owner.username, collection.id)} className={className}>{children}</Link>} pagination={state.page.nextCursor ? <DesktopPaginationTrigger loadKey={state.page.nextCursor} hasMore loading={loadingMore} onLoadMore={loadMore} loadingLabel="Loading more collections…" /> : null} />
}

function CreateCollectionDialog({ workspace, onCreated }: { workspace: WorkspaceDetails; onCreated: (collection: Collection) => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [submitting, setSubmitting] = useState(false); const [formError, setFormError] = useState<string>()
  function changeOpen(next: boolean) { setOpen(next); if (!next) { setName(""); setDescription(""); setFormError(undefined) } }
  async function submit(event: FormEvent) { event.preventDefault(); const normalizedName = name.trim(); if (!normalizedName) { setFormError("Name is required."); return } setSubmitting(true); setFormError(undefined); try { const input = { name: normalizedName, ownerUserId: workspace.owner.id, ...(description.trim() ? { description: description.trim() } : {}) } satisfies CreateCollectionInput; const collection = await apiJSON<Collection>("/api/v1/collections", { method: "POST", body: input }); onCreated(collection); changeOpen(false) } catch (error) { setFormError(errorMessage(error)) } finally { setSubmitting(false) } }
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button size="sm"><PlusIcon />New collection</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Create collection</DialogTitle><DialogDescription>Create this collection for @{workspace.owner.username}.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submit}>{formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}<div className="grid gap-2"><label htmlFor="collection-name" className="text-sm font-medium">Name</label><Input id="collection-name" value={name} autoFocus disabled={submitting} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-2"><label htmlFor="collection-description" className="text-sm font-medium">Description</label><Textarea id="collection-description" value={description} disabled={submitting} onChange={(event) => setDescription(event.target.value)} /></div><DialogFooter><Button type="button" variant="outline" disabled={submitting} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? <Loader2Icon className="animate-spin" /> : null}Create</Button></DialogFooter></form></DialogContent></Dialog>
}
function collectionQuery(ownerId: string, cursor?: string): CollectionsQuery { return { ownerId, limit: 50, cursor } }
function appendUnique(current: readonly Collection[], incoming: readonly Collection[]) { const ids = new Set(current.map((collection) => collection.id)); return [...current, ...incoming.filter((collection) => !ids.has(collection.id) && !!ids.add(collection.id))] }

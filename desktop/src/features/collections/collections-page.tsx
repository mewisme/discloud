import type { Collection, CollectionPage, CollectionsQuery, CreateCollectionInput, WorkspaceDetails } from "@discloud/api/models"
import { formatDate } from "@discloud/shared/format"
import { workspaceCollectionPath } from "@discloud/shared/navigation"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Textarea } from "@discloud/ui/components/textarea"
import { FolderHeartIcon, Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails; page: CollectionPage }

export function DesktopCollectionsPage() {
  const { username } = useParams()
  const [state, setState] = useState<State>({ status: "loading" })
  const [loadingMore, setLoadingMore] = useState(false)
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
        const page = await apiJSON<CollectionPage>("/api/v1/collections", { query: collectionQuery(workspace.owner.id) })
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

    try {
      const page = await apiJSON<CollectionPage>("/api/v1/collections", { query: collectionQuery(state.workspace.owner.id, state.page.nextCursor) })
      setState((current) => current.status === "ready"
        ? { ...current, page: { ...page, collections: appendUnique(current.page.collections, page.collections) } }
        : current)
    } finally {
      setLoadingMore(false)
    }
  }

  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>

  if (state.status === "error") {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button size="sm" variant="outline" onClick={() => setRetryVersion((value) => value + 1)}><RefreshCwIcon />Try again</Button>
        </div>
      </div>
    )
  }

  function created(collection: Collection) {
    setState((current) => current.status === "ready"
      ? { ...current, page: { ...current.page, collections: [...current.page.collections, collection].sort((a, b) => a.name.localeCompare(b.name)) } }
      : current)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
          <p className="text-sm text-muted-foreground">Collections owned by @{state.workspace.owner.username}.</p>
        </div>
        <CreateCollectionDialog workspace={state.workspace} onCreated={created} />
      </div>

      {state.page.collections.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div className="space-y-3">
            <FolderHeartIcon className="mx-auto size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No collections yet</p>
              <p className="text-sm text-muted-foreground">Create one to group related files.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {state.page.collections.map((collection) => (
            <Link key={collection.id} to={workspaceCollectionPath(state.workspace.owner.username, collection.id)} className="group">
              <Card className="h-full transition-colors group-hover:bg-muted/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{collection.name}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">{collection.description || "No description"}</CardDescription>
                    </div>
                    <Badge variant="secondary" className="capitalize">{collection.accessLevel}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">Updated {formatDate(collection.updatedAt)}</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {state.page.nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? <Loader2Icon className="animate-spin" /> : null}
            {loadingMore ? "Loading" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function CreateCollectionDialog({ workspace, onCreated }: { workspace: WorkspaceDetails; onCreated: (collection: Collection) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string>()

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) {
      setName("")
      setDescription("")
      setFormError(undefined)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const normalizedName = name.trim()

    if (!normalizedName) {
      setFormError("Name is required.")
      return
    }

    setSubmitting(true)
    setFormError(undefined)

    try {
      const input = {
        name: normalizedName,
        ownerUserId: workspace.owner.id,
        ...(description.trim() ? { description: description.trim() } : {}),
      } satisfies CreateCollectionInput

      const collection = await apiJSON<Collection>("/api/v1/collections", { method: "POST", body: input })
      onCreated(collection)
      changeOpen(false)
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><PlusIcon />New collection</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create collection</DialogTitle>
          <DialogDescription>Create this collection for @{workspace.owner.username}.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}

          <div className="grid gap-2">
            <label htmlFor="collection-name" className="text-sm font-medium">Name</label>
            <Input id="collection-name" value={name} autoFocus disabled={submitting} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="grid gap-2">
            <label htmlFor="collection-description" className="text-sm font-medium">Description</label>
            <Textarea id="collection-description" value={description} disabled={submitting} onChange={(event) => setDescription(event.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => changeOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2Icon className="animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function collectionQuery(ownerId: string, cursor?: string): CollectionsQuery {
  return { ownerId, limit: 50, cursor }
}

function appendUnique(current: readonly Collection[], incoming: readonly Collection[]) {
  const ids = new Set(current.map((collection) => collection.id))
  return [...current, ...incoming.filter((collection) => !ids.has(collection.id) && !!ids.add(collection.id))]
}
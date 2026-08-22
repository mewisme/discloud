import type { AddCollectionItemInput, Collection, CollectionItem, SearchPage, SearchQuery, SearchResult, UpdateCollectionInput } from "@discloud/api/models"
import { FileTypeIcon } from "@discloud/app-ui/files/file-node-visual"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Textarea } from "@discloud/ui/components/textarea"
import { FilePlusIcon, Loader2Icon, PencilIcon, SearchIcon, Trash2Icon } from "lucide-react"
import type { FormEvent } from "react"
import { useEffect, useMemo, useState } from "react"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

export function DesktopAddCollectionItemDialog({
  collectionId,
  existingItems,
  onAdded,
}: {
  collectionId: string
  existingItems: readonly CollectionItem[]
  onAdded: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string>()
  const [error, setError] = useState<string>()
  const existing = useMemo(() => new Set(existingItems.map((item) => item.fileId)), [existingItems])

  useEffect(() => {
    if (!open) return

    let cancelled = false

    const timeout = setTimeout(async () => {
      setLoading(true)
      setError(undefined)

      try {
        const q = query.trim()
        const searchQuery = {
          q: q || undefined,
          kind: "file",
          sort: q ? "relevance" : "updated",
          order: "desc",
          limit: 25,
        } satisfies SearchQuery

        const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery })

        if (!cancelled) {
          setResults(page.results.filter((item) => !!item.parentId))
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [open, query])

  async function add(fileId: string) {
    setPendingId(fileId)
    setError(undefined)

    try {
      const input = { fileId } satisfies AddCollectionItemInput

      await apiJSON<{ created: boolean }>(
        `/api/v1/collections/${encodeURIComponent(collectionId)}/items`,
        { method: "POST", body: input },
      )

      await onAdded()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPendingId(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FilePlusIcon />
          Add files
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add files</DialogTitle>
          <DialogDescription>Add workspace files without moving them from their folders.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} autoFocus placeholder="Search files..." className="pl-9" onChange={(event) => setQuery(event.target.value)} />
        </div>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {loading ? (
            <div className="grid h-32 place-items-center">
              <Loader2Icon className="animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">No files found.</div>
          ) : (
            <div className="divide-y">
              {results.map((item) => {
                const added = existing.has(item.id)

                return (
                  <div key={item.id} className="flex items-center gap-3 p-3">
                    <FileTypeIcon category={item.category} className="size-4 shrink-0" />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-xs capitalize text-muted-foreground">{item.category || item.mimeType || "File"}</p>
                    </div>

                    <Button size="sm" variant="outline" disabled={added || pendingId === item.id} onClick={() => void add(item.id)}>
                      {pendingId === item.id ? <Loader2Icon className="animate-spin" /> : null}
                      {added ? "Added" : "Add"}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DesktopEditCollectionDialog({
  collection,
  onUpdated,
}: {
  collection: Collection
  onUpdated: (collection: Collection) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(collection.name)
  const [description, setDescription] = useState(collection.description ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  function changeOpen(next: boolean) {
    if (pending) return

    setOpen(next)

    if (!next) {
      setName(collection.name)
      setDescription(collection.description ?? "")
      setError(undefined)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()

    const normalizedName = name.trim()

    if (!normalizedName) {
      setError("Name is required.")
      return
    }

    setPending(true)
    setError(undefined)

    try {
      const input = {
        name: normalizedName,
        description: description.trim(),
      } satisfies UpdateCollectionInput

      const updated = await apiJSON<Collection>(
        `/api/v1/collections/${encodeURIComponent(collection.id)}`,
        { method: "PATCH", body: input },
      )

      onUpdated(updated)
      changeOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon />
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit collection</DialogTitle>
          <DialogDescription>Change its name or description.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-2">
            <label htmlFor="edit-collection-name" className="text-sm font-medium">Name</label>
            <Input id="edit-collection-name" value={name} disabled={pending} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="grid gap-2">
            <label htmlFor="edit-collection-description" className="text-sm font-medium">Description</label>
            <Textarea id="edit-collection-description" value={description} disabled={pending} onChange={(event) => setDescription(event.target.value)} />
          </div>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DesktopTrashCollectionButton({
  collection,
  onTrashed,
}: {
  collection: Collection
  onTrashed: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function trash() {
    if (pending) return

    setPending(true)
    setError(undefined)

    try {
      await apiJSON<void>(`/api/v1/collections/${encodeURIComponent(collection.id)}`, {
        method: "DELETE",
      })

      onTrashed()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <Trash2Icon />
          Trash
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Trash this collection?</AlertDialogTitle>
          <AlertDialogDescription>The collection will move to Trash. Files themselves are not deleted.</AlertDialogDescription>
        </AlertDialogHeader>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => void trash()}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            Trash collection
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
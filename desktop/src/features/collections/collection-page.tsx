import type { Collection, CollectionItem, CollectionItems } from "@discloud/api/models"
import { FileBreadcrumbs } from "@discloud/app-ui/files/file-breadcrumbs"
import { FileTypeIcon } from "@discloud/app-ui/files/file-node-visual"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { workspaceCollectionFilePath, workspaceCollectionPath } from "@discloud/shared/navigation"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { DownloadIcon, FilePlusIcon, Loader2Icon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { downloadNativeFile } from "../files/native"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; collection: Collection; items: readonly CollectionItem[] }

export function DesktopCollectionPage() {
  const { username, collectionId } = useParams()
  const [state, setState] = useState<State>({ status: "loading" })
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [actionError, setActionError] = useState<string>()

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!collectionId) {
        setState({ status: "error", message: "Collection ID is missing." })
        return
      }

      try {
        const [collection, items] = await Promise.all([
          apiJSON<Collection>(`/api/v1/collections/${encodeURIComponent(collectionId)}`),
          apiJSON<CollectionItems>(`/api/v1/collections/${encodeURIComponent(collectionId)}/items`),
        ])

        if (!cancelled) setState({ status: "ready", collection, items: items.items })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [collectionId])

  async function remove(item: CollectionItem) {
    if (state.status !== "ready" || pending.has(item.fileId)) return

    setPending((current) => new Set(current).add(item.fileId))
    setActionError(undefined)

    try {
      await apiJSON<void>(`/api/v1/collections/${encodeURIComponent(state.collection.id)}/items/${encodeURIComponent(item.fileId)}`, { method: "DELETE" })
      setState((current) => current.status === "ready" ? { ...current, items: current.items.filter((candidate) => candidate.fileId !== item.fileId) } : current)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(item.fileId)
        return next
      })
    }
  }

  async function download(item: CollectionItem) {
    if (state.status !== "ready" || pending.has(item.fileId)) return

    setPending((current) => new Set(current).add(item.fileId))
    setActionError(undefined)

    try {
      await downloadNativeFile({ id: item.fileId, name: item.name }, state.collection.id)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(item.fileId)
        return next
      })
    }
  }

  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
  if (state.status === "error" || !username) return <p role="alert" className="text-sm text-destructive">{state.status === "error" ? state.message : "Workspace username is missing."}</p>

  const collectionsPath = workspaceCollectionPath(username)
  const canEdit = state.collection.accessLevel !== "view"

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <FileBreadcrumbs items={[
        { id: "collections", label: "Collections", href: `#${collectionsPath}` },
        { id: `collection:${state.collection.id}`, label: state.collection.name },
      ]} />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{state.collection.name}</h1>
          <Badge variant="secondary" className="capitalize">{state.collection.accessLevel}</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{state.collection.description || "No description"}</p>
      </div>

      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

      {state.items.length === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <FilePlusIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
            <p className="font-medium">No files in this collection</p>
            <p className="mt-1 text-sm text-muted-foreground">{canEdit ? "Files can be added from collection actions later." : "Files will appear here when they are added."}</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead className="hidden sm:table-cell">Size</TableHead>
                <TableHead className="hidden lg:table-cell">Added</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {state.items.map((item) => (
                <TableRow key={item.fileId}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <FileTypeIcon category={item.category} className="size-4 shrink-0 text-muted-foreground" />
                      <Link to={workspaceCollectionFilePath(username, state.collection.id, item.fileId)} className="truncate font-medium hover:underline">{item.name}</Link>
                    </div>
                  </TableCell>
                  <TableCell className="hidden capitalize text-muted-foreground md:table-cell">{item.category || "File"}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatBytes(item.size)}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(item.addedAt)}</TableCell>

                  <TableCell>
                    <div className="flex justify-end">
                      <Button size="icon-sm" variant="ghost" disabled={pending.has(item.fileId)} aria-label={`Download ${item.name}`} onClick={() => void download(item)}>
                        {pending.has(item.fileId) ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                      </Button>

                      {canEdit ? (
                        <Button size="icon-sm" variant="ghost" disabled={pending.has(item.fileId)} aria-label={`Remove ${item.name}`} onClick={() => void remove(item)}>
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
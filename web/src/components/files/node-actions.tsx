"use client"

import { Fragment, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronRightIcon, FolderIcon, FolderPlusIcon, Globe2Icon, Loader2Icon, MoreHorizontalIcon, MoveIcon, PencilIcon, StarIcon, StarOffIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { PublicShareDialog } from "@/components/shares/public-share-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { apiJSON } from "@/lib/api/client"
import type { BrowserNode, CreateFolderInput, FolderChildrenQuery, Node, NodePage, UpdateNodeInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import type { BrowserOptions, BrowserOrder, BrowserSort } from "@/lib/files/browser"
import { apiErrorMessage } from "@/lib/helpers"

const nameFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").refine((value) => value !== "." && value !== "..", "Dot names are not allowed").refine((value) => ![/[/\\\u0000]/].some((pattern) => pattern.test(value)), "Path separators are not allowed"),
})

type NameValues = z.infer<typeof nameFormSchema>
type Reload = () => Promise<void>

export function CreateFolderDialog({ folder, onReload, openEvent }: { folder: Node; onReload: Reload; openEvent?: string }) {
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string>()
  const form = useForm<NameValues>({ resolver: zodResolver(nameFormSchema), defaultValues: { name: "" } })

  useEffect(() => {
    if (!openEvent) return

    const handleOpen = () => setOpen(true)
    window.addEventListener(openEvent, handleOpen)
    return () => window.removeEventListener(openEvent, handleOpen)
  }, [openEvent])

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) {
      form.reset()
      setFormError(undefined)
    }
  }

  async function submit(values: NameValues) {
    setFormError(undefined)

    try {
      const input: CreateFolderInput = { parentId: folder.id, name: values.name }
      await apiJSON<Node>("/api/v1/folders", { method: "POST", body: input })
      changeOpen(false)
      toast.success("Folder created")
      try {
        await onReload()
      } catch {
        toast.error("Folder created, but the browser could not refresh")
      }
    } catch (error) {
      if (error instanceof APIError && (error.status === 400 || error.status === 409)) {
        form.setError("name", { message: error.message }, { shouldFocus: true })
        return
      }
      setFormError(apiErrorMessage(error, "Could not create folder."))
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FolderPlusIcon />
          New folder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
          <DialogDescription>Create a folder inside {folder.isRoot ? "your workspace" : folder.name}.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          {formError && <ErrorAlert message={formError} />}
          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="folder-name">Name</FieldLabel>
            <Input id="folder-name" autoFocus disabled={form.formState.isSubmitting} aria-invalid={!!form.formState.errors.name} {...form.register("name")} />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => changeOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2Icon className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NodeActionsMenu({
  node,
  folder,
  breadcrumbs,
  page,
  options,
  onReload,
  onMoved,
  onFavorite,
}: {
  node: BrowserNode
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
  options: BrowserOptions
  onReload: Reload
  onMoved: (nodeId: string) => void
  onFavorite: (node: BrowserNode, favorite: boolean) => Promise<void>
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const [favoritePending, setFavoritePending] = useState(false)
  const editable = node.accessLevel !== "view"
  const canPublicShare = node.accessLevel === "full"

  if (!editable && !node.canFavorite && !canPublicShare) return null

  async function favorite() {
    setFavoritePending(true)
    try {
      await onFavorite(node, !node.isFavorite)
    } finally {
      setFavoritePending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${node.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {editable && (
            <>
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                <MoveIcon />
                Move
              </DropdownMenuItem>
            </>
          )}

          {canPublicShare && (
            <>
              {editable && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setPublicShareOpen(true)}>
                <Globe2Icon />
                Public link
              </DropdownMenuItem>
            </>
          )}

          {(editable || canPublicShare) && node.canFavorite && <DropdownMenuSeparator />}

          {node.canFavorite && (
            <DropdownMenuItem disabled={favoritePending} onSelect={() => void favorite()}>
              {favoritePending ? <Loader2Icon className="animate-spin" /> : node.isFavorite ? <StarOffIcon /> : <StarIcon />}
              {node.isFavorite ? "Remove from favorites" : "Add to favorites"}
            </DropdownMenuItem>
          )}

          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setTrashOpen(true)}>
                <Trash2Icon />
                Move to trash
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen && <RenameNodeDialog node={node} open onOpenChange={setRenameOpen} onReload={onReload} />}

      {moveOpen && (
        <MoveNodesDialog
          nodes={[node]}
          folder={folder}
          breadcrumbs={breadcrumbs}
          initialPage={page}
          options={options}
          open
          onOpenChange={setMoveOpen}
          onMoved={(nodeIds) => nodeIds.forEach(onMoved)}
        />
      )}

      {trashOpen && (
        <TrashNodesDialog
          nodes={[node]}
          open
          onOpenChange={setTrashOpen}
          onTrashed={async () => {
            try {
              await onReload()
            } catch {
              toast.error("Moved to trash, but the browser could not refresh")
            }
          }}
        />
      )}

      {canPublicShare && (
        <PublicShareDialog
          resourceType={node.kind}
          resourceId={node.id}
          resourceName={node.name}
          open={publicShareOpen}
          onOpenChange={setPublicShareOpen}
          trigger={null}
        />
      )}
    </>
  )
}

function RenameNodeDialog({ node, open, onOpenChange, onReload }: { node: BrowserNode; open: boolean; onOpenChange: (open: boolean) => void; onReload: Reload }) {
  const [formError, setFormError] = useState<string>()
  const form = useForm<NameValues>({ resolver: zodResolver(nameFormSchema), defaultValues: { name: node.name } })

  async function submit(values: NameValues) {
    setFormError(undefined)

    try {
      const input: UpdateNodeInput = { name: values.name }
      await apiJSON<Node>(`/api/v1/nodes/${node.id}`, { method: "PATCH", body: input })
      onOpenChange(false)
      toast.success("Renamed")
      try {
        await onReload()
      } catch {
        toast.error("Renamed, but the browser could not refresh")
      }
    } catch (error) {
      if (error instanceof APIError && (error.status === 400 || error.status === 409)) {
        form.setError("name", { message: error.message }, { shouldFocus: true })
        return
      }
      setFormError(apiErrorMessage(error, "Could not rename this item."))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {node.kind}</DialogTitle>
          <DialogDescription>Choose a new name for {node.name}.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          {formError && <ErrorAlert message={formError} />}
          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor={`rename-${node.id}`}>Name</FieldLabel>
            <Input id={`rename-${node.id}`} autoFocus disabled={form.formState.isSubmitting} aria-invalid={!!form.formState.errors.name} {...form.register("name")} />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2Icon className="animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TrashNodesDialog({
  nodes,
  open,
  onOpenChange,
  onTrashed,
}: {
  nodes: readonly BrowserNode[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onTrashed: (nodeIds: readonly string[]) => void | Promise<void>
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const count = nodes.length
  const single = count === 1 ? nodes[0] : undefined

  function changeOpen(next: boolean) {
    if (pending) return
    onOpenChange(next)
    if (!next) setError(undefined)
  }

  async function trash() {
    if (!nodes.length || pending) return

    const targets = [...nodes]
    setPending(true)
    setError(undefined)

    try {
      const { successful, errors } = await runNodeOperations(targets, (node) => {
        const id = encodeURIComponent(node.id)
        const path = node.kind === "folder" ? `/api/v1/folders/${id}` : `/api/v1/files/${id}`
        return apiJSON<void>(path, { method: "DELETE" })
      })

      if (successful.length) await onTrashed(successful)

      if (errors.some((cause) => cause instanceof APIError && cause.status === 401)) {
        router.replace("/login")
        router.refresh()
        return
      }

      if (errors.length) {
        setError(
          errors.length === 1
            ? apiErrorMessage(errors[0], "Could not move this item to trash.")
            : `${errors.length} of ${targets.length} items could not be moved to trash.`,
        )
        return
      }

      onOpenChange(false)
      toast.success(single ? `${single.name} moved to trash` : `${targets.length} items moved to trash`)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {single ? `Move ${single.name} to trash?` : `Move ${count} items to trash?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {single?.kind === "folder"
              ? "The folder and its contents will disappear from Files. You can restore the folder from Trash."
              : single
                ? "The file will disappear from Files. You can restore it from Trash."
                : "The selected items will disappear from Files. Selected folders include their contents. You can restore them from Trash."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <ErrorAlert message={error} />}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!nodes.length || pending} onClick={() => void trash()}>
            {pending && <Loader2Icon className="animate-spin" />}
            {single ? "Move to trash" : `Move ${count} items to trash`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function MoveNodesDialog({
  nodes,
  folder,
  breadcrumbs,
  initialPage,
  options,
  open,
  onOpenChange,
  onMoved,
}: {
  nodes: readonly BrowserNode[]
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  options: BrowserOptions
  open: boolean
  onOpenChange: (open: boolean) => void
  onMoved: (nodeIds: readonly string[]) => void
}) {
  const router = useRouter()
  const [path, setPath] = useState<Node[]>(() => [...breadcrumbs])
  const [page, setPage] = useState<NodePage>(initialPage)
  const [sort, setSort] = useState<BrowserSort>(options.sort)
  const [order, setOrder] = useState<BrowserOrder>(options.order)
  const [loading, setLoading] = useState(false)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string>()
  const current = path[path.length - 1] ?? folder
  const ownerUserId = nodes[0]?.ownerUserId
  const selectedIds = new Set(nodes.map((node) => node.id))
  const sameOwner = !!ownerUserId && nodes.every((node) => node.ownerUserId === ownerUserId)
  const editable = nodes.length > 0 && nodes.every((node) => node.accessLevel !== "view")
  const folders = page.nodes.filter((item) => item.kind === "folder" && !selectedIds.has(item.id) && item.ownerUserId === ownerUserId)
  const canMoveHere = editable
    && sameOwner
    && page.accessLevel !== "view"
    && current.ownerUserId === ownerUserId
    && nodes.every((node) => current.id !== node.id && current.id !== node.parentId)
  const single = nodes.length === 1 ? nodes[0] : undefined

  async function navigate(target: Node, pathIndex?: number) {
    if (loading) return
    setLoading(true)
    setError(undefined)

    try {
      const query = { limit: 100, sort: "name", order: "asc" } satisfies FolderChildrenQuery
      const next = await apiJSON<NodePage>(`/api/v1/folders/${target.id}/children`, { query })
      setPage(next)
      setSort("name")
      setOrder("asc")
      setPath((currentPath) => pathIndex == null ? [...currentPath, target] : currentPath.slice(0, pathIndex + 1))
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }

      setError(apiErrorMessage(cause, "Could not open this folder."))
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!page.nextCursor || loading) return
    setLoading(true)

    try {
      const query = { limit: 100, sort, order, cursor: page.nextCursor } satisfies FolderChildrenQuery
      const next = await apiJSON<NodePage>(`/api/v1/folders/${current.id}/children`, { query })

      setPage((currentPage) => ({
        ...next,
        nodes: appendUniqueNodes(currentPage.nodes, next.nodes),
      }))
    } catch (cause) {
      setError(apiErrorMessage(cause, "Could not load more folders."))
    } finally {
      setLoading(false)
    }
  }

  async function move() {
    if (!canMoveHere || moving) return

    const targets = [...nodes]
    setMoving(true)
    setError(undefined)

    try {
      const input: UpdateNodeInput = { parentId: current.id }
      const { successful, errors } = await runNodeOperations(
        targets,
        (node) => apiJSON<Node>(`/api/v1/nodes/${node.id}`, { method: "PATCH", body: input }),
      )

      if (successful.length) onMoved(successful)

      if (errors.some((cause) => cause instanceof APIError && cause.status === 401)) {
        router.replace("/login")
        router.refresh()
        return
      }

      if (errors.length) {
        setError(
          errors.length === 1
            ? apiErrorMessage(errors[0], "Could not move this item.")
            : `${errors.length} of ${targets.length} items could not be moved.`,
        )
        return
      }

      onOpenChange(false)
      toast.success(single ? `${single.name} moved` : `${targets.length} items moved`)
    } finally {
      setMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!moving) onOpenChange(next)
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{single ? `Move ${single.name}` : `Move ${nodes.length} items`}</DialogTitle>
          <DialogDescription>Choose another folder in the same ownership domain.</DialogDescription>
        </DialogHeader>

        {error && <ErrorAlert message={error} />}

        <Breadcrumb>
          <BreadcrumbList>
            {path.map((item, index) => {
              const active = index === path.length - 1

              return (
                <Fragment key={item.id}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {active ? (
                      <BreadcrumbPage>{item.isRoot ? "Files" : item.name}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <button type="button" disabled={loading || moving} onClick={() => void navigate(item, index)}>
                          {item.isRoot ? "Files" : item.name}
                        </button>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
          {loading && page.nodes.length === 0 ? (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Loading…
            </div>
          ) : folders.length === 0 ? (
            <div className="grid h-28 place-items-center text-sm text-muted-foreground">No child folders here.</div>
          ) : (
            folders.map((item) => (
              <Button key={item.id} type="button" variant="ghost" className="w-full justify-start" disabled={loading || moving} onClick={() => void navigate(item)}>
                <FolderIcon />
                <span className="truncate">{item.name}</span>
                <ChevronRightIcon className="ml-auto" />
              </Button>
            ))
          )}

          {page.nextCursor && (
            <Button type="button" variant="ghost" className="w-full" disabled={loading || moving} onClick={() => void loadMore()}>
              {loading && <Loader2Icon className="animate-spin" />}
              Load more
            </Button>
          )}
        </div>

        {!canMoveHere && (
          <p className="text-xs text-muted-foreground">
            {!sameOwner
              ? "All selected items must belong to the same owner."
              : !editable
                ? "You do not have permission to move every selected item."
                : nodes.some((node) => node.parentId === current.id)
                  ? "The selected items are already in this folder."
                  : page.accessLevel === "view"
                    ? "You only have view access to this folder."
                    : "This folder cannot be used as the destination."}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={moving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!canMoveHere || moving} onClick={() => void move()}>
            {moving && <Loader2Icon className="animate-spin" />}
            {single ? "Move here" : `Move ${nodes.length} items here`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

async function runNodeOperations(
  nodes: readonly BrowserNode[],
  operation: (node: BrowserNode) => Promise<unknown>,
) {
  const successful: string[] = []
  const errors: unknown[] = []

  for (let index = 0; index < nodes.length; index += 8) {
    const batch = nodes.slice(index, index + 8)
    const results = await Promise.allSettled(batch.map(operation))

    results.forEach((result, offset) => {
      if (result.status === "fulfilled") successful.push(batch[offset].id)
      else errors.push(result.reason)
    })
  }

  return { successful, errors }
}

function appendUniqueNodes(current: readonly BrowserNode[], incoming: readonly BrowserNode[]) {
  const ids = new Set(current.map((node) => node.id))
  return [...current, ...incoming.filter((node) => !ids.has(node.id))]
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
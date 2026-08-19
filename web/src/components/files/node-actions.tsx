"use client"

import { Fragment, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronRightIcon, FolderIcon, FolderPlusIcon, Loader2Icon, MoreHorizontalIcon, MoveIcon, PencilIcon, StarIcon, StarOffIcon, TriangleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
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

const nameFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").refine((value) => value !== "." && value !== "..", "Dot names are not allowed").refine((value) => !/[\/\\\u0000]/.test(value), "Path separators are not allowed"),
})

type NameValues = z.infer<typeof nameFormSchema>
type Reload = () => Promise<void>

export function CreateFolderDialog({ folder, onReload }: { folder: Node; onReload: Reload }) {
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string>()
  const form = useForm<NameValues>({ resolver: zodResolver(nameFormSchema), defaultValues: { name: "" } })

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
      setFormError(apiMessage(error, "Could not create folder."))
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
          <DialogDescription>Create a folder inside {folder.isRoot ? "Files" : folder.name}.</DialogDescription>
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
  const [favoritePending, setFavoritePending] = useState(false)
  const editable = node.accessLevel !== "view"

  if (!editable && !node.canFavorite) return null

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
        <DropdownMenuContent align="end">
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
          {editable && node.canFavorite && <DropdownMenuSeparator />}
          {node.canFavorite && (
            <DropdownMenuItem disabled={favoritePending} onSelect={() => void favorite()}>
              {favoritePending ? <Loader2Icon className="animate-spin" /> : node.isFavorite ? <StarOffIcon /> : <StarIcon />}
              {node.isFavorite ? "Remove from favorites" : "Add to favorites"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {renameOpen && <RenameNodeDialog node={node} open onOpenChange={setRenameOpen} onReload={onReload} />}
      {moveOpen && (
        <MoveNodeDialog
          node={node}
          folder={folder}
          breadcrumbs={breadcrumbs}
          initialPage={page}
          options={options}
          open
          onOpenChange={setMoveOpen}
          onMoved={onMoved}
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
      setFormError(apiMessage(error, "Could not rename this item."))
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

function MoveNodeDialog({
  node,
  folder,
  breadcrumbs,
  initialPage,
  options,
  open,
  onOpenChange,
  onMoved,
}: {
  node: BrowserNode
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  options: BrowserOptions
  open: boolean
  onOpenChange: (open: boolean) => void
  onMoved: (nodeId: string) => void
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
  const folders = page.nodes.filter((item) => item.kind === "folder" && item.id !== node.id && item.ownerUserId === node.ownerUserId)
  const canMoveHere = page.accessLevel !== "view" && current.ownerUserId === node.ownerUserId && current.id !== node.id && current.id !== node.parentId

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
      setError(apiMessage(cause, "Could not open this folder."))
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
      setPage((currentPage) => ({ ...next, nodes: [...currentPage.nodes, ...next.nodes] }))
    } catch (cause) {
      setError(apiMessage(cause, "Could not load more folders."))
    } finally {
      setLoading(false)
    }
  }

  async function move() {
    if (!canMoveHere || moving) return
    setMoving(true)
    setError(undefined)

    try {
      const input: UpdateNodeInput = { parentId: current.id }
      await apiJSON<Node>(`/api/v1/nodes/${node.id}`, { method: "PATCH", body: input })
      onMoved(node.id)
      onOpenChange(false)
      toast.success(`${node.name} moved`)
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }
      setError(apiMessage(cause, "Could not move this item."))
    } finally {
      setMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move {node.name}</DialogTitle>
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
                        <button type="button" disabled={loading} onClick={() => void navigate(item, index)}>{item.isRoot ? "Files" : item.name}</button>
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
              <Button key={item.id} type="button" variant="ghost" className="w-full justify-start" disabled={loading} onClick={() => void navigate(item)}>
                <FolderIcon />
                <span className="truncate">{item.name}</span>
                <ChevronRightIcon className="ml-auto" />
              </Button>
            ))
          )}

          {page.nextCursor && (
            <Button type="button" variant="ghost" className="w-full" disabled={loading} onClick={() => void loadMore()}>
              {loading && <Loader2Icon className="animate-spin" />}
              Load more
            </Button>
          )}
        </div>

        {!canMoveHere && (
          <p className="text-xs text-muted-foreground">
            {current.id === node.parentId ? "This item is already in this folder." : page.accessLevel === "view" ? "You only have view access to this folder." : "This folder cannot be used as the destination."}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={moving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!canMoveHere || moving} onClick={() => void move()}>
            {moving && <Loader2Icon className="animate-spin" />}
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function apiMessage(error: unknown, fallback: string) {
  if (!(error instanceof APIError)) return fallback
  return error.message || fallback
}
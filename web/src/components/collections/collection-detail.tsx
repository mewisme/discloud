"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { DownloadIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FilePlusIcon, FileTextIcon, FileVideoIcon, Loader2Icon, PencilIcon, SearchIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateOnly } from "@/components/common/date-time"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { apiJSON } from "@/lib/api/client"
import type { AddCollectionItemInput, Collection, CollectionItem, CollectionItems, SearchPage, SearchQuery, SearchResult, UpdateCollectionInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { collectionFilePath, collectionPath } from "@/lib/files/navigation"
import { apiErrorMessage, formatBytes } from "@/lib/helpers"

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string(),
})

type FormValues = z.infer<typeof formSchema>

export function CollectionDetail({
  initialCollection,
  initialItems,
}: {
  initialCollection: Collection
  initialItems: readonly CollectionItem[]
}) {
  const router = useRouter()
  const workspace = useWorkspace()
  const [collection, setCollection] = useState(initialCollection)
  const [items, setItems] = useState<CollectionItem[]>(() => [...initialItems])
  const canEdit = collection.accessLevel !== "view"
  const collectionsHref = collectionPath(workspace.username)

  async function reloadItems() {
    const data = await apiJSON<CollectionItems>(
      `/api/v1/collections/${collection.id}/items`,
    )
    setItems([...data.items])
  }

  async function removeItem(fileId: string) {
    try {
      await apiJSON<void>(
        `/api/v1/collections/${collection.id}/items/${fileId}`,
        { method: "DELETE" },
      )
      setItems((current) => current.filter((item) => item.fileId !== fileId))
      toast.success("Removed from collection")
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not remove file"))
    }
  }

  async function trash() {
    try {
      await apiJSON<void>(`/api/v1/collections/${collection.id}`, {
        method: "DELETE",
      })

      toast.success("Collection moved to trash")
      router.replace(collectionsHref)
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not trash collection"))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={collectionsHref}>Collections</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbSeparator />

          <BreadcrumbItem>
            <BreadcrumbPage>{collection.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {collection.name}
            </h1>

            <Badge variant="secondary" className="capitalize">
              {collection.accessLevel}
            </Badge>
          </div>

          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {collection.description || "No description"}
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <AddItemDialog
              collectionId={collection.id}
              existingItems={items}
              onAdded={reloadItems}
            />

            <EditCollectionDialog
              collection={collection}
              onUpdated={setCollection}
            />

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
                  <AlertDialogDescription>
                    The collection will move to Trash. Files themselves are not deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => void trash()}
                  >
                    Trash collection
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <FilePlusIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
            <p className="font-medium">No files in this collection</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canEdit
                ? "Add files without moving them from their folders."
                : "Files will appear here when they are added."}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
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
              {items.map((item) => (
                <TableRow key={item.fileId}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <ItemIcon item={item} />

                      <Link
                        href={collectionFilePath(
                          workspace.username,
                          collection.id,
                          item.fileId,
                        )}
                        className="truncate font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                    </div>
                  </TableCell>

                  <TableCell className="hidden capitalize text-muted-foreground md:table-cell">
                    {item.category || "File"}
                  </TableCell>

                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {formatBytes(item.size)}
                  </TableCell>

                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    <DateOnly value={item.addedAt} />
                  </TableCell>

                  <TableCell>
                    <div className="flex justify-end">
                      <Button size="icon-sm" variant="ghost" asChild>
                        <a
                          href={collectionDownloadURL(
                            collection.id,
                            item.fileId,
                          )}
                          aria-label={`Download ${item.name}`}
                        >
                          <DownloadIcon />
                        </a>
                      </Button>

                      {canEdit && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => void removeItem(item.fileId)}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
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

function EditCollectionDialog({
  collection,
  onUpdated,
}: {
  collection: Collection
  onUpdated: (collection: Collection) => void
}) {
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string>()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: collection.name,
      description: collection.description ?? "",
    },
  })

  function changeOpen(next: boolean) {
    setOpen(next)

    if (!next) {
      form.reset({
        name: collection.name,
        description: collection.description ?? "",
      })
      setFormError(undefined)
    }
  }

  async function submit(values: FormValues) {
    setFormError(undefined)

    try {
      const input: UpdateCollectionInput = {
        name: values.name,
        description: values.description.trim(),
      }

      const updated = await apiJSON<Collection>(
        `/api/v1/collections/${collection.id}`,
        {
          method: "PATCH",
          body: input,
        },
      )

      onUpdated(updated)
      changeOpen(false)
      toast.success("Collection updated")
    } catch (error) {
      if (error instanceof APIError && [400, 409].includes(error.status)) {
        form.setError(
          "name",
          { message: error.message },
          { shouldFocus: true },
        )
        return
      }

      setFormError(apiErrorMessage(error, "Could not update collection"))
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
          <DialogDescription>
            Change its name or description.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="edit-collection-name">Name</FieldLabel>
            <Input
              id="edit-collection-name"
              disabled={form.formState.isSubmitting}
              aria-invalid={!!form.formState.errors.name}
              {...form.register("name")}
            />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-collection-description">
              Description
            </FieldLabel>
            <Textarea
              id="edit-collection-description"
              disabled={form.formState.isSubmitting}
              {...form.register("description")}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={form.formState.isSubmitting}
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && (
                <Loader2Icon className="animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddItemDialog({
  collectionId,
  existingItems,
  onAdded,
}: {
  collectionId: string
  existingItems: readonly CollectionItem[]
  onAdded: () => Promise<void>
}) {
  const workspace = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string>()
  const existing = useMemo(
    () => new Set(existingItems.map((item) => item.fileId)),
    [existingItems],
  )

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()

    const timeout = setTimeout(async () => {
      setLoading(true)

      try {
        const q = query.trim()

        const searchQuery: SearchQuery = {
          q: q || undefined,
          ownerId: workspace.id,
          kind: "file",
          sort: q ? "relevance" : "updated",
          order: "desc",
          limit: 25,
        }

        const page = await apiJSON<SearchPage>("/api/v1/search", {
          query: searchQuery,
          signal: controller.signal,
        })

        setResults(
          page.results.filter((item) => !!item.parentId),
        )
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(apiErrorMessage(error, "Could not search files"))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 300)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [open, query, workspace.id])

  async function add(fileId: string) {
    setPendingId(fileId)

    try {
      const input: AddCollectionItemInput = { fileId }

      const result = await apiJSON<{ created: boolean }>(
        `/api/v1/collections/${collectionId}/items`,
        {
          method: "POST",
          body: input,
        },
      )

      await onAdded()

      toast.success(
        result.created
          ? "File added"
          : "File is already in this collection",
      )
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not add file"))
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
          <DialogDescription>
            Choose files from @{workspace.username}&apos;s workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            autoFocus
            placeholder="Search files…"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {loading ? (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2Icon className="size-4 animate-spin" />
                Searching…
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">
              No files found.
            </div>
          ) : (
            <div className="divide-y">
              {results.map((item) => {
                const added = existing.has(item.id)

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3"
                  >
                    <SearchResultIcon result={item} />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.name}
                      </p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {item.category || item.mimeType || "File"}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={added || pendingId === item.id}
                      onClick={() => void add(item.id)}
                    >
                      {pendingId === item.id && (
                        <Loader2Icon className="animate-spin" />
                      )}
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

function ItemIcon({ item }: { item: CollectionItem }) {
  return fileIcon(item.category)
}

function SearchResultIcon({ result }: { result: SearchResult }) {
  return fileIcon(result.category)
}

function fileIcon(category?: string) {
  switch (category) {
    case "image":
      return <FileImageIcon className="size-4 shrink-0" />
    case "video":
      return <FileVideoIcon className="size-4 shrink-0" />
    case "audio":
      return <FileAudioIcon className="size-4 shrink-0" />
    case "document":
    case "text":
      return <FileTextIcon className="size-4 shrink-0" />
    case "archive":
      return <FileArchiveIcon className="size-4 shrink-0" />
    default:
      return <FileIcon className="size-4 shrink-0" />
  }
}

function collectionDownloadURL(collectionId: string, fileId: string) {
  return `/api/backend/api/v1/files/${encodeURIComponent(fileId)}/download?collectionId=${encodeURIComponent(collectionId)}`
}
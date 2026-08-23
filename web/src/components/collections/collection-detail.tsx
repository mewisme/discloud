"use client"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@discloud/ui/components/alert-dialog"
import { Badge } from "@discloud/ui/components/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@discloud/ui/components/breadcrumb"
import { Button } from "@discloud/ui/components/button"
import { FilePlusIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { AddCollectionItemDialog } from "@/components/collections/detail/add-collection-item-dialog"
import { CollectionItemsTable } from "@/components/collections/detail/collection-items-table"
import { EditCollectionDialog } from "@/components/collections/detail/edit-collection-dialog"
import { apiJSON } from "@/lib/api/client"
import type { Collection, CollectionItem, CollectionItems } from "@/lib/api/models"
import { collectionPath } from "@/lib/files/navigation"
import { apiErrorMessage } from "@/lib/helpers"

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
    const data = await apiJSON<CollectionItems>(`/api/v1/collections/${collection.id}/items`)
    setItems([...data.items])
  }

  async function removeItem(fileId: string) {
    try {
      await apiJSON<void>(`/api/v1/collections/${collection.id}/items/${fileId}`, { method: "DELETE" })
      setItems((current) => current.filter((item) => item.fileId !== fileId))
      toast.success("Removed from collection")
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not remove file"))
    }
  }

  async function trash() {
    try {
      await apiJSON<void>(`/api/v1/collections/${collection.id}`, { method: "DELETE" })
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
            <h1 className="truncate text-2xl font-semibold tracking-tight">{collection.name}</h1>
            <Badge variant="secondary" className="capitalize">{collection.accessLevel}</Badge>
          </div>

          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {collection.description || "No description"}
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <AddCollectionItemDialog collectionId={collection.id} existingItems={items} onAdded={reloadItems} />
            <EditCollectionDialog collection={collection} onUpdated={setCollection} />

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
                  <AlertDialogAction variant="destructive" onClick={() => void trash()}>
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
        <CollectionItemsTable
          collectionId={collection.id}
          items={items}
          canEdit={canEdit}
          onRemove={removeItem}
        />
      )}
    </div>
  )
}
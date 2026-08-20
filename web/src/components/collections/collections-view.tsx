"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { FolderHeartIcon, Loader2Icon, PlusIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateOnly } from "@/components/common/date-time"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { apiJSON } from "@/lib/api/client"
import type { Collection, CollectionPage, CollectionsQuery, CreateCollectionInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { collectionPath } from "@/lib/files/navigation"
import { apiErrorMessage } from "@/lib/helpers"

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string(),
})

type FormValues = z.infer<typeof formSchema>

export function CollectionsView({ initialPage }: { initialPage: CollectionPage }) {
  const workspace = useWorkspace()
  const [collections, setCollections] = useState<Collection[]>(() => [...initialPage.collections])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)

  function created(collection: Collection) {
    setCollections((current) => [...current, collection].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)

    try {
      const query = {
        ownerId: workspace.id,
        limit: 50,
        cursor: nextCursor,
      } satisfies CollectionsQuery

      const page = await apiJSON<CollectionPage>("/api/v1/collections", { query })
      setCollections((current) => [...current, ...page.collections])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load more collections"))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
          <p className="text-sm text-muted-foreground">
            Collections owned by @{workspace.username}.
          </p>
        </div>

        <CreateCollectionDialog onCreated={created} />
      </div>

      {collections.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div className="space-y-3">
            <FolderHeartIcon className="mx-auto size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No collections yet</p>
              <p className="text-sm text-muted-foreground">
                Create one to group related files.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {collections.map((collection) => (
            <Link
              key={collection.id}
              href={collectionPath(workspace.username, collection.id)}
              className="group"
            >
              <Card className="h-full transition-colors group-hover:bg-muted/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        {collection.name}
                      </CardTitle>

                      <CardDescription className="mt-1 line-clamp-2">
                        {collection.description || "No description"}
                      </CardDescription>
                    </div>

                    <Badge variant="secondary" className="capitalize">
                      {collection.accessLevel}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="text-xs text-muted-foreground">
                  Updated <DateOnly value={collection.updatedAt} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore && <Loader2Icon className="animate-spin" />}
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  )
}

function CreateCollectionDialog({
  onCreated,
}: {
  onCreated: (collection: Collection) => void
}) {
  const workspace = useWorkspace()
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string>()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "" },
  })

  function changeOpen(next: boolean) {
    setOpen(next)

    if (!next) {
      form.reset()
      setFormError(undefined)
    }
  }

  async function submit(values: FormValues) {
    setFormError(undefined)

    try {
      const input: CreateCollectionInput = {
        name: values.name,
        ownerUserId: workspace.id,
        ...(values.description.trim()
          ? { description: values.description.trim() }
          : {}),
      }

      const collection = await apiJSON<Collection>("/api/v1/collections", {
        method: "POST",
        body: input,
      })

      onCreated(collection)
      changeOpen(false)
      toast.success("Collection created")
    } catch (error) {
      if (error instanceof APIError && [400, 409].includes(error.status)) {
        form.setError(
          "name",
          { message: error.message },
          { shouldFocus: true },
        )
        return
      }

      setFormError(apiErrorMessage(error, "Could not create collection"))
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          New collection
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create collection</DialogTitle>
          <DialogDescription>
            Create this collection for @{workspace.username}.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="collection-name">Name</FieldLabel>
            <Input
              id="collection-name"
              autoFocus
              disabled={form.formState.isSubmitting}
              aria-invalid={!!form.formState.errors.name}
              {...form.register("name")}
            />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="collection-description">
              Description
            </FieldLabel>
            <Textarea
              id="collection-description"
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
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
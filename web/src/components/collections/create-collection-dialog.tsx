"use client"

import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Field, FieldError, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Textarea } from "@discloud/ui/components/textarea"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { collectionFormSchema, type CollectionFormValues } from "@/components/collections/collection-form-schema"
import { apiJSON } from "@/lib/api/client"
import type { Collection, CreateCollectionInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

export function CreateCollectionDialog({
  onCreated,
}: {
  onCreated: (collection: Collection) => void
}) {
  const workspace = useWorkspace()
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string>()
  const form = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { name: "", description: "" },
  })

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) {
      form.reset()
      setFormError(undefined)
    }
  }

  async function submit(values: CollectionFormValues) {
    setFormError(undefined)

    try {
      const input: CreateCollectionInput = {
        name: values.name,
        ownerUserId: workspace.id,
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
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
        form.setError("name", { message: error.message }, { shouldFocus: true })
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
          <DialogDescription>Create this collection for @{workspace.username}.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}

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
            <FieldLabel htmlFor="collection-description">Description</FieldLabel>
            <Textarea id="collection-description" disabled={form.formState.isSubmitting} {...form.register("description")} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => changeOpen(false)}>
              Cancel
            </Button>
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
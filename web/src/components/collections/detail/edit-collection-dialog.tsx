"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon, PencilIcon } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { collectionFormSchema, type CollectionFormValues } from "@/components/collections/collection-form-schema"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { apiJSON } from "@/lib/api/client"
import type { Collection, UpdateCollectionInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

export function EditCollectionDialog({
  collection,
  onUpdated,
}: {
  collection: Collection
  onUpdated: (collection: Collection) => void
}) {
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string>()
  const form = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
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

  async function submit(values: CollectionFormValues) {
    setFormError(undefined)

    try {
      const input: UpdateCollectionInput = {
        name: values.name,
        description: values.description.trim(),
      }

      const updated = await apiJSON<Collection>(
        `/api/v1/collections/${collection.id}`,
        { method: "PATCH", body: input },
      )

      onUpdated(updated)
      changeOpen(false)
      toast.success("Collection updated")
    } catch (error) {
      if (error instanceof APIError && [400, 409].includes(error.status)) {
        form.setError("name", { message: error.message }, { shouldFocus: true })
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
          <DialogDescription>Change its name or description.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}

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
            <FieldLabel htmlFor="edit-collection-description">Description</FieldLabel>
            <Textarea id="edit-collection-description" disabled={form.formState.isSubmitting} {...form.register("description")} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
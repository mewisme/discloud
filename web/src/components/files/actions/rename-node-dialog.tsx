"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { NodeActionError } from "@/components/files/actions/node-action-error"
import { nodeNameSchema, type NodeNameValues, type ReloadNodes } from "@/components/files/actions/node-name-schema"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { apiJSON } from "@/lib/api/client"
import type { BrowserNode, Node, UpdateNodeInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

export function RenameNodeDialog({
  node,
  open,
  onOpenChange,
  onReload,
}: {
  node: BrowserNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onReload: ReloadNodes
}) {
  const [formError, setFormError] = useState<string>()
  const form = useForm<NodeNameValues>({ resolver: zodResolver(nodeNameSchema), defaultValues: { name: node.name } })

  async function submit(values: NodeNameValues) {
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
          {formError && <NodeActionError message={formError} />}

          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor={`rename-${node.id}`}>Name</FieldLabel>
            <Input
              id={`rename-${node.id}`}
              autoFocus
              disabled={form.formState.isSubmitting}
              aria-invalid={!!form.formState.errors.name}
              {...form.register("name")}
            />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>

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
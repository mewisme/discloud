"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { FolderPlusIcon, Loader2Icon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { NodeActionError } from "@/components/files/actions/node-action-error"
import { nodeNameSchema, type NodeNameValues, type ReloadNodes } from "@/components/files/actions/node-name-schema"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { apiJSON } from "@/lib/api/client"
import type { CreateFolderInput, Node } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

export function CreateFolderDialog({
  folder,
  onReload,
  openEvent,
  trigger,
}: {
  folder: Node
  onReload: ReloadNodes
  openEvent?: string
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string>()
  const form = useForm<NodeNameValues>({ resolver: zodResolver(nodeNameSchema), defaultValues: { name: "" } })

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

  async function submit(values: NodeNameValues) {
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
        {trigger ?? (
          <Button>
            <FolderPlusIcon />
            New folder
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
          <DialogDescription>Create a folder inside {folder.isRoot ? "your workspace" : folder.name}.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          {formError && <NodeActionError message={formError} />}

          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="folder-name">Name</FieldLabel>
            <Input
              id="folder-name"
              autoFocus
              disabled={form.formState.isSubmitting}
              aria-invalid={!!form.formState.errors.name}
              {...form.register("name")}
            />
            <FieldError errors={[form.formState.errors.name]} />
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
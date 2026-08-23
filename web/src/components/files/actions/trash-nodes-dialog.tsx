"use client"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { NodeActionError } from "@/components/files/actions/node-action-error"
import { apiJSON } from "@/lib/api/client"
import type { BrowserNode } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { runNodeOperations } from "@/lib/files/node-operations"
import { apiErrorMessage } from "@/lib/helpers"

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

        {error && <NodeActionError message={error} />}

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
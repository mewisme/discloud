import type { BrowserNode } from "@discloud/api/models"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

export function DesktopTrashNodesDialog({
  nodes,
  open,
  onOpenChange,
  onTrashed,
}: {
  nodes: readonly BrowserNode[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onTrashed: (nodeIds: readonly string[]) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const single = nodes.length === 1 ? nodes[0] : undefined

  async function trash() {
    if (!nodes.length || pending) return

    setPending(true)
    setError(undefined)

    const successful: string[] = []
    const errors: unknown[] = []

    for (const node of nodes) {
      try {
        const id = encodeURIComponent(node.id)
        const path = node.kind === "folder" ? `/api/v1/folders/${id}` : `/api/v1/files/${id}`

        await apiJSON<void>(path, { method: "DELETE" })
        successful.push(node.id)
      } catch (cause) {
        errors.push(cause)
      }
    }

    if (successful.length) onTrashed(successful)

    if (errors.length) {
      setError(
        errors.length === 1
          ? errorMessage(errors[0])
          : `${errors.length} of ${nodes.length} items could not be moved to trash.`,
      )
      setPending(false)
      return
    }

    setPending(false)
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => {
      if (!pending) onOpenChange(next)
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {single ? `Move ${single.name} to trash?` : `Move ${nodes.length} items to trash?`}
          </AlertDialogTitle>

          <AlertDialogDescription>
            {single?.kind === "folder"
              ? "The folder and its contents will disappear from Files. You can restore it from Trash."
              : single
                ? "The file will disappear from Files. You can restore it from Trash."
                : "Selected items will disappear from Files. Folders include their contents."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!nodes.length || pending} onClick={() => void trash()}>
            {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
            Move to trash
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
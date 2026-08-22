import type { BrowserNode, Node, UpdateNodeInput } from "@discloud/api/models"
import { nodeNameError, normalizedNodeName } from "@discloud/shared/node-name"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Loader2Icon } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

export function DesktopRenameNodeDialog({
  node,
  open,
  onOpenChange,
  onRenamed,
}: {
  node: BrowserNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onRenamed: () => void
}) {
  const [name, setName] = useState(node.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent) {
    event.preventDefault()

    const validation = nodeNameError(name)

    if (validation) {
      setError(validation)
      return
    }

    setPending(true)
    setError(undefined)

    try {
      const input = {
        name: normalizedNodeName(name),
      } satisfies UpdateNodeInput

      await apiJSON<Node>(`/api/v1/nodes/${encodeURIComponent(node.id)}`, {
        method: "PATCH",
        body: input,
      })

      onOpenChange(false)
      onRenamed()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!pending) onOpenChange(next)
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {node.kind}</DialogTitle>
          <DialogDescription>Choose a new name for {node.name}.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <Input
            value={name}
            autoFocus
            disabled={pending}
            aria-invalid={!!error}
            onChange={(event) => setName(event.target.value)}
          />

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
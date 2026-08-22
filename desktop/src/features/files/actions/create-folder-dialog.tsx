import type { CreateFolderInput, Node } from "@discloud/api/models"
import { nodeNameError, normalizedNodeName } from "@discloud/shared/node-name"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { FolderPlusIcon, Loader2Icon } from "lucide-react"
import type { FormEvent, ReactNode } from "react"
import { useState } from "react"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

export function DesktopCreateFolderDialog({
  folder,
  onCreated,
  trigger,
}: {
  folder: Node
  onCreated: () => void
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  function changeOpen(next: boolean) {
    if (pending) return

    setOpen(next)

    if (!next) {
      setName("")
      setError(undefined)
    }
  }

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
        parentId: folder.id,
        name: normalizedNodeName(name),
      } satisfies CreateFolderInput

      await apiJSON<Node>("/api/v1/folders", {
        method: "POST",
        body: input,
      })

      changeOpen(false)
      onCreated()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <FolderPlusIcon />
            New folder
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
          <DialogDescription>Create a folder inside {folder.isRoot ? "this workspace" : folder.name}.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-2">
            <label htmlFor="new-folder-name" className="text-sm font-medium">Name</label>
            <Input
              id="new-folder-name"
              value={name}
              autoFocus
              disabled={pending}
              aria-invalid={!!error}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
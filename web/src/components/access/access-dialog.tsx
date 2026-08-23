"use client"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Loader2Icon, Share2Icon, Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { AccessGrantForm } from "@/components/access/access-grant-form"
import { AccessGrantsTable } from "@/components/access/access-grants-table"
import { type AccessResource, useAccessGrants } from "@/components/access/use-access-grants"

type AccessDialogProps = {
  resource: AccessResource
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode | null
}

export function AccessDialog({
  resource,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: AccessDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const access = useAccessGrants(resource, open)
  const triggerNode = trigger === undefined ? (
    <Button size="sm" variant="outline">
      <Share2Icon />
      Share
    </Button>
  ) : trigger

  function changeOpen(next: boolean) {
    if (!next && access.mutating) return

    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)

    if (!next) access.reset()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        {triggerNode && <DialogTrigger asChild>{triggerNode}</DialogTrigger>}

        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage access</DialogTitle>
            <DialogDescription>Share {resource.name} with another DisCloud user.</DialogDescription>
          </DialogHeader>

          <AccessGrantForm
            username={access.username}
            level={access.level}
            mutating={access.mutating}
            adding={access.adding}
            onUsernameChange={access.setUsername}
            onLevelChange={access.setLevel}
            onAdd={() => void access.add()}
          />

          {access.error && <p role="alert" className="text-sm text-destructive">{access.error}</p>}

          <p className="text-xs text-muted-foreground">
            Enter the exact username to add a user. View can read. Edit can change content. Full can also manage access.
            {resource.type === "folder" && " Folder access is inherited by descendants; removing a direct grant does not remove access inherited from an ancestor."}
          </p>

          {access.loading ? (
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
              <div role="status" className="flex items-center gap-2">
                <Loader2Icon className="size-4 animate-spin" />
                Loading access…
              </div>
            </div>
          ) : access.grants.length === 0 ? (
            <div className="grid min-h-32 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
              No direct grants.
            </div>
          ) : (
            <AccessGrantsTable
              grants={access.grants}
              mutating={access.mutating}
              pendingUserId={access.pendingUserId}
              onUpdate={(userId, level) => void access.update(userId, level)}
              onRemove={access.openRemove}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!access.removeTarget} onOpenChange={access.changeRemoveOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>

            <AlertDialogTitle>Remove access?</AlertDialogTitle>

            <AlertDialogDescription>
              {access.removeTarget
                ? `Remove direct access to ${resource.name} for ${access.removeTarget.name} (@${access.removeTarget.username})?`
                : "Remove this direct access grant?"}
              {resource.type === "folder" && " Access inherited from another folder will remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {access.removeError && <p role="alert" className="text-sm text-destructive">{access.removeError}</p>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={access.removing}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={access.removing} onClick={() => void access.remove()}>
              {access.removing && <Loader2Icon className="animate-spin" />}
              {access.removing ? "Removing…" : "Remove access"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
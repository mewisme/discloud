"use client"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@discloud/ui/components/alert-dialog"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { CopyIcon, ExternalLinkIcon, Globe2Icon, Loader2Icon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import type { ActiveShareQuery, CreateShareInput, Share, ShareResourceType } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

type PublicShareDialogProps = {
  resourceType: ShareResourceType
  resourceId: string
  resourceName: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode | null
}

export function PublicShareDialog({ resourceType, resourceId, resourceName, open: controlledOpen, onOpenChange, trigger }: PublicShareDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [share, setShare] = useState<Share>()
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const open = controlledOpen ?? internalOpen
  const publicPath = share ? `/s/${encodeURIComponent(share.publicId)}` : undefined
  const triggerNode = trigger === undefined ? (
    <Button size="sm" variant="outline">
      <Globe2Icon />
      Public link
    </Button>
  ) : trigger

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    setLoading(true)
    setError(undefined)

    async function load() {
      try {
        const query = { resourceType, resourceId } satisfies ActiveShareQuery
        const active = await apiJSON<Share>("/api/v1/shares/active", { query, signal: controller.signal })
        if (!controller.signal.aborted) setShare(active)
      } catch (cause) {
        if (controller.signal.aborted) return
        if (cause instanceof APIError && cause.status === 404) setShare(undefined)
        else setError(apiErrorMessage(cause, "Could not load public link"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [open, resourceId, resourceType])

  function changeOpen(next: boolean) {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
    if (!next) setError(undefined)
  }

  async function create() {
    setPending(true)
    setError(undefined)

    try {
      const input = { resourceType, resourceId } satisfies CreateShareInput
      const created = await apiJSON<Share>("/api/v1/shares", { method: "POST", body: input })
      setShare(created)
      toast.success("Public link created")
    } catch (cause) {
      setError(apiErrorMessage(cause, "Could not create public link"))
    } finally {
      setPending(false)
    }
  }

  async function copy() {
    if (!publicPath) return

    try {
      await navigator.clipboard.writeText(new URL(publicPath, window.location.origin).toString())
      toast.success("Public link copied")
    } catch {
      toast.error("Could not copy link")
    }
  }

  async function revoke() {
    if (!share) return
    setPending(true)
    setError(undefined)

    try {
      await apiJSON<void>(`/api/v1/shares/${share.id}`, { method: "DELETE" })
      setShare(undefined)
      toast.success("Public link revoked")
    } catch (cause) {
      setError(apiErrorMessage(cause, "Could not revoke public link"))
    } finally {
      setPending(false)
    }
  }

  async function regenerate() {
    if (!share) return
    setPending(true)
    setError(undefined)

    try {
      await apiJSON<void>(`/api/v1/shares/${share.id}`, { method: "DELETE" })
      setShare(undefined)
      const input = { resourceType, resourceId } satisfies CreateShareInput
      const created = await apiJSON<Share>("/api/v1/shares", { method: "POST", body: input })
      setShare(created)
      toast.success("Public link regenerated")
    } catch (cause) {
      setError(apiErrorMessage(cause, "Could not regenerate public link"))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {triggerNode && <DialogTrigger asChild>{triggerNode}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Public link</DialogTitle>
          <DialogDescription>Anyone with this link can access {resourceName} without signing in.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid min-h-36 place-items-center text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2Icon className="size-4 animate-spin" />
              Loading public link…
            </div>
          </div>
        ) : share && publicPath ? (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="mb-3 flex items-center gap-2">
                <div className="grid size-9 place-items-center rounded-lg bg-background shadow-sm">
                  <Globe2Icon className="size-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Public access enabled</p>
                    <Badge variant="secondary">Active</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">No account is required.</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Input readOnly value={publicPath} className="font-mono text-xs" />
                <Button size="icon" variant="outline" aria-label="Copy public link" onClick={() => void copy()}>
                  <CopyIcon />
                </Button>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" asChild>
                <a href={publicPath} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon />
                  Open
                </a>
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => void regenerate()}>
                {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                Regenerate
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={pending}>
                    <Trash2Icon />
                    Revoke
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke this public link?</AlertDialogTitle>
                    <AlertDialogDescription>The current URL will immediately stop working. You can create another public link later.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void revoke()}>Revoke link</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed bg-muted/20 p-5 text-center">
              <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-muted">
                <Globe2Icon className="size-5 text-muted-foreground" />
              </div>
              <p className="font-medium">Private</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Create an opaque public URL that can be revoked or regenerated at any time.</p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end">
              <Button disabled={pending} onClick={() => void create()}>
                {pending ? <Loader2Icon className="animate-spin" /> : <Globe2Icon />}
                Create public link
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
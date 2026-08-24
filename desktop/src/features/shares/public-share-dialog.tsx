import type { ActiveShareQuery, CreateShareInput, Share, ShareResourceType, UpdateShareInput } from "@discloud/api/models"
import { APIError } from "@discloud/api/types"
import { PublicShareSettings } from "@discloud/app-ui/shares/public-share-settings"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { CopyButton } from "@discloud/ui/components/copy-button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Globe2Icon, Loader2Icon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { useDesktopSession } from "#components/desktop-session"
import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

export function DesktopPublicShareDialog({
  resourceType,
  resourceId,
  resourceName,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  resourceType: ShareResourceType
  resourceId: string
  resourceName: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode | null
}) {
  const { state } = useDesktopSession()
  const [internalOpen, setInternalOpen] = useState(false)
  const [share, setShare] = useState<Share>()
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [error, setError] = useState<string>()
  const open = controlledOpen ?? internalOpen
  const serverUrl = state.status === "connected" ? state.serverUrl : undefined
  const publicURL = share && serverUrl ? publicShareURL(serverUrl, share.publicId) : undefined
  const triggerNode = trigger === undefined ? (
    <Button size="sm" variant="outline">
      <Globe2Icon />
      Public link
    </Button>
  ) : trigger

  useEffect(() => {
    if (!open) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(undefined)

      try {
        const query = { resourceType, resourceId } satisfies ActiveShareQuery
        const active = await apiJSON<Share>("/api/v1/shares/active", { query })
        if (!cancelled) setShare(active)
      } catch (cause) {
        if (cancelled) return

        if (cause instanceof APIError && cause.status === 404) setShare(undefined)
        else setError(errorMessage(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [open, resourceId, resourceType])

  function changeOpen(next: boolean) {
    if (pending) return
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)

    if (!next) {
      setError(undefined)
    }
  }

  async function create() {
    if (pending) return

    setPending(true)
    setError(undefined)

    try {
      const input = { resourceType, resourceId } satisfies CreateShareInput
      setShare(await apiJSON<Share>("/api/v1/shares", { method: "POST", body: input }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  async function saveSettings(input: UpdateShareInput) {
    if (!share || pending) return
    setPending(true)
    setError(undefined)
    try {
      setShare(await apiJSON<Share>(`/api/v1/shares/${encodeURIComponent(share.id)}`, { method: "PATCH", body: input }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  async function revokeSessions() {
    if (!share || pending) return
    setPending(true)
    setError(undefined)
    try {
      await apiJSON<void>(`/api/v1/shares/${encodeURIComponent(share.id)}/sessions`, { method: "DELETE" })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  async function revoke() {
    if (!share || pending) return

    setPending(true)
    setError(undefined)

    try {
      await apiJSON<void>(`/api/v1/shares/${encodeURIComponent(share.id)}`, { method: "DELETE" })
      setShare(undefined)
      setRevokeOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  async function regenerate() {
    if (!share || pending) return

    setPending(true)
    setError(undefined)

    try {
      await apiJSON<void>(`/api/v1/shares/${encodeURIComponent(share.id)}`, { method: "DELETE" })

      const input = { resourceType, resourceId } satisfies CreateShareInput
      setShare(await apiJSON<Share>("/api/v1/shares", { method: "POST", body: input }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        {triggerNode ? <DialogTrigger asChild>{triggerNode}</DialogTrigger> : null}

        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Public link</DialogTitle>
            <DialogDescription>Anyone with this link can access {resourceName} without signing in.</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="grid min-h-36 place-items-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="animate-spin" />
                Loading public link
              </div>
            </div>
          ) : share && publicURL ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Globe2Icon className="size-4" />
                  <p className="text-sm font-medium">Public access enabled</p>
                  <Badge variant="secondary">Active</Badge>
                </div>

                <div className="flex gap-2">
                  <Input readOnly value={publicURL} className="font-mono text-xs" />
                  <CopyButton value={publicURL} label="Copy public link" size="icon" variant="outline" onCopyError={(cause) => setError(errorMessage(cause))} />
                </div>

              </div>

              <PublicShareSettings share={share} pending={pending} onSave={saveSettings} onRevokeSessions={revokeSessions} />

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={pending} onClick={() => void regenerate()}>
                  {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                  Regenerate
                </Button>

                <Button variant="destructive" disabled={pending} onClick={() => setRevokeOpen(true)}>
                  <Trash2Icon />
                  Revoke
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-dashed p-5 text-center">
                <Globe2Icon className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="font-medium">Private</p>
                <p className="mt-1 text-sm text-muted-foreground">Create an opaque public URL that can be revoked at any time.</p>
              </div>

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

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

      <AlertDialog open={revokeOpen} onOpenChange={(next) => {
        if (!pending) setRevokeOpen(next)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this public link?</AlertDialogTitle>
            <AlertDialogDescription>The current URL will immediately stop working.</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={() => void revoke()}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              Revoke link
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function publicShareURL(serverUrl: string, publicId: string) {
  return `${serverUrl.replace(/\/+$/, "")}/s/${encodeURIComponent(publicId)}`
}
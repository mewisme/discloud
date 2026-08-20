"use client"

import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { apiJSON } from "@/lib/api/client"
import type { QuotaReconciliationPage, ReconcileQuotaInput } from "@/lib/api/models"
import { apiErrorMessage, formatBytes } from "@/lib/helpers"

export function ReconcileQuotaDialog({ onReconciled }: { onReconciled: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<QuotaReconciliationPage | null>(null)

  const changedUsers = result?.users.filter((user) => user.changed) ?? []
  const overQuotaUsers = result?.users.filter((user) => user.overQuota) ?? []
  const attentionUsers = result?.users.filter((user) => user.changed || user.overQuota) ?? []

  function handleOpenChange(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) setResult(null)
  }

  async function reconcile() {
    setPending(true)

    try {
      const input = {} satisfies ReconcileQuotaInput
      const nextResult = await apiJSON<QuotaReconciliationPage>("/admin/storage/reconcile", { method: "POST", body: input })
      setResult(nextResult)
      await onReconciled()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not reconcile storage quota."))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <Button variant="outline" onClick={() => {
        setResult(null)
        setOpen(true)
      }}>
        <RefreshCwIcon />
        Reconcile quota
      </Button>

      <AlertDialogContent className="sm:max-w-2xl">
        {!result ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Reconcile storage quota?</AlertDialogTitle>
              <AlertDialogDescription>
                DisCloud will recalculate used and reserved storage from canonical database state and repair cached quota counters that no longer match.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button disabled={pending} onClick={() => void reconcile()}>
                {pending && <Loader2Icon className="animate-spin" />}
                Reconcile
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Quota reconciliation complete</AlertDialogTitle>
              <AlertDialogDescription>
                Checked {result.users.length} account{result.users.length === 1 ? "" : "s"} · {changedUsers.length} changed
                {overQuotaUsers.length > 0 ? ` · ${overQuotaUsers.length} over quota` : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {attentionUsers.length === 0 ? (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                Storage quota counters were already consistent.
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {attentionUsers.map((user) => (
                  <div key={user.userId} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        {user.changed && <span className="rounded-md bg-muted px-2 py-1">Repaired</span>}
                        {user.overQuota && <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">Over quota</span>}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-muted-foreground">Used</p>
                        <p className="mt-0.5 tabular-nums">
                          {formatBytes(user.beforeUsedBytes)} → {formatBytes(user.afterUsedBytes)}
                        </p>
                      </div>

                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-muted-foreground">Reserved</p>
                        <p className="mt-0.5 tabular-nums">
                          {formatBytes(user.beforeReservedBytes)} → {formatBytes(user.afterReservedBytes)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Quota: {user.quotaBytes === null ? "Unlimited" : formatBytes(user.quotaBytes)}</span>
                      <span className="font-mono">{user.userId}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <AlertDialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
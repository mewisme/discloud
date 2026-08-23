"use client"

import { Button } from "@discloud/ui/components/button"
import { Checkbox } from "@discloud/ui/components/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { Field, FieldGroup, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { adminUserLabel, formatQuotaGiB, getAdminUser, parseQuotaGiB } from "@/components/admin/users/admin-user-utils"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, SetUserQuotaInput } from "@/lib/api/models"
import { apiErrorMessage, formatBytes } from "@/lib/helpers"

export function UserQuotaDialog({
  user,
  open,
  onOpenChange,
  onUpdated,
}: {
  user: AdminUser
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: (user: AdminUser) => void
}) {
  const [unlimited, setUnlimited] = useState(user.storageQuotaBytes === null)
  const [quotaGiB, setQuotaGiB] = useState(formatQuotaGiB(user.storageQuotaBytes))
  const [pending, setPending] = useState(false)

  function handleOpenChange(next: boolean) {
    if (pending) return

    if (next) {
      setUnlimited(user.storageQuotaBytes === null)
      setQuotaGiB(formatQuotaGiB(user.storageQuotaBytes))
    }

    onOpenChange(next)
  }

  async function save() {
    let storageQuotaBytes: number | null

    if (unlimited) {
      storageQuotaBytes = null
    } else {
      try {
        const quota = parseQuotaGiB(quotaGiB)

        if (quota === undefined) {
          toast.error("Enter a quota or select Unlimited")
          return
        }

        storageQuotaBytes = quota
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Invalid storage quota")
        return
      }
    }

    setPending(true)

    try {
      const input = { storageQuotaBytes } satisfies SetUserQuotaInput
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/quota`, { method: "PUT", body: input })

      const updated = await getAdminUser(user.id)
      onUpdated(updated)
      onOpenChange(false)

      toast.success(
        updated.storageQuotaBytes === null
          ? `Storage quota removed for ${adminUserLabel(updated)}`
          : `Storage quota for ${adminUserLabel(updated)} set to ${formatBytes(updated.storageQuotaBytes)}`,
      )
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update storage quota."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Storage quota</DialogTitle>
          <DialogDescription>
            {adminUserLabel(user)} currently uses {formatBytes(user.storageUsedBytes)}
            {user.storageReservedBytes > 0 ? ` with ${formatBytes(user.storageReservedBytes)} reserved.` : "."}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>
              <Checkbox checked={unlimited} disabled={pending} onCheckedChange={(value) => setUnlimited(value === true)} />
              Unlimited storage
            </FieldLabel>
          </Field>

          <Field data-disabled={unlimited}>
            <FieldLabel htmlFor={`admin-quota-${user.id}`}>Quota (GiB)</FieldLabel>
            <Input id={`admin-quota-${user.id}`} type="number" min="0" step="0.1" value={quotaGiB} disabled={pending || unlimited} onChange={(event) => setQuotaGiB(event.target.value)} />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void save()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Save quota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
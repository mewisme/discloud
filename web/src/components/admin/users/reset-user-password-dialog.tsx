"use client"

import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { adminUserLabel, getAdminUser } from "@/components/admin/users/admin-user-utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, ResetUserPasswordInput } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export function ResetUserPasswordDialog({
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
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)

  function handleOpenChange(next: boolean) {
    if (pending) return
    if (next) setPassword("")
    onOpenChange(next)
  }

  async function reset() {
    if (!password) {
      toast.error("Temporary password is required")
      return
    }

    setPending(true)

    try {
      const input = { password } satisfies ResetUserPasswordInput
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, { method: "POST", body: input })

      onUpdated(await getAdminUser(user.id))
      onOpenChange(false)
      setPassword("")
      toast.success(`Password reset for ${adminUserLabel(user)}. Existing sessions were revoked.`)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not reset this password."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a temporary password for {adminUserLabel(user)}. Existing sessions will be revoked and the user must change the password after signing in.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor={`admin-password-${user.id}`}>Temporary password</FieldLabel>
          <Input id={`admin-password-${user.id}`} type="password" autoFocus required minLength={1} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          <FieldDescription>Only 1 character is required because this password must be replaced after the next sign-in.</FieldDescription>
        </Field>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void reset()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
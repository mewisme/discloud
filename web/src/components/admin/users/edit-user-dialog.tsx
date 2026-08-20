"use client"

import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { type AdminRole, adminUserLabel } from "@/components/admin/users/admin-user-utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, UpdateUserInput } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export function EditUserDialog({
  user,
  self,
  open,
  onOpenChange,
  onUpdated,
}: {
  user: AdminUser
  self: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: (user: AdminUser) => void
}) {
  const [name, setName] = useState(user.name)
  const [role, setRole] = useState<AdminRole>(user.role)
  const [pending, setPending] = useState(false)

  function handleOpenChange(next: boolean) {
    if (pending) return

    if (next) {
      setName(user.name)
      setRole(user.role)
    }

    onOpenChange(next)
  }

  async function save() {
    const displayName = name.trim()

    if (!displayName) {
      toast.error("Name is required")
      return
    }

    const input = {
      ...(displayName !== user.name ? { name: displayName } : {}),
      ...(!self && role !== user.role ? { role } : {}),
    } satisfies UpdateUserInput

    if (Object.keys(input).length === 0) {
      toast.info("No account changes to save")
      return
    }

    setPending(true)

    try {
      const updated = await apiJSON<AdminUser>(`/admin/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: input })
      onUpdated(updated)
      onOpenChange(false)
      toast.success("Account updated")
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update this user."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>Update the display name and role for {adminUserLabel(user)}. Username is permanent.</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`admin-name-${user.id}`}>Name</FieldLabel>
            <Input id={`admin-name-${user.id}`} autoFocus maxLength={100} value={name} disabled={pending} onChange={(event) => setName(event.target.value)} />
          </Field>

          <Field>
            <FieldLabel htmlFor={`admin-username-${user.id}`}>Username</FieldLabel>
            <Input id={`admin-username-${user.id}`} value={user.username} disabled readOnly />
            <FieldDescription>Username is immutable because it identifies the account and workspace route.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`admin-role-${user.id}`}>Role</FieldLabel>
            <Select value={role} disabled={pending || self} onValueChange={(value) => setRole(value as AdminRole)}>
              <SelectTrigger id={`admin-role-${user.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Role</SelectLabel>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            {self && <FieldDescription>Use another administrator account to change your own role.</FieldDescription>}
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void save()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
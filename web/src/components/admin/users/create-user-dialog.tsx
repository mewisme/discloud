"use client"

import { Loader2Icon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { type AdminRole, parseQuotaGiB, temporaryPasswordMinLength, validateTemporaryPassword } from "@/components/admin/users/admin-user-utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, CreateUserInput } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export function CreateUserDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<AdminRole>("user")
  const [quotaGiB, setQuotaGiB] = useState("")
  const [pending, setPending] = useState(false)

  function reset() {
    setUsername("")
    setName("")
    setPassword("")
    setRole("user")
    setQuotaGiB("")
  }

  function handleOpenChange(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) reset()
  }

  async function create() {
    const displayName = name.trim()
    const accountUsername = username.trim()

    if (!displayName) {
      toast.error("Name is required")
      return
    }

    if (!accountUsername) {
      toast.error("Username is required")
      return
    }

    const passwordError = validateTemporaryPassword(password)
    if (passwordError) {
      toast.error(passwordError)
      return
    }

    let quota: number | undefined

    try {
      quota = parseQuotaGiB(quotaGiB)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid storage quota")
      return
    }

    setPending(true)

    try {
      const input = {
        name: displayName,
        username: accountUsername,
        password,
        role,
        ...(quota === undefined ? {} : { storageQuotaBytes: quota }),
      } satisfies CreateUserInput

      await apiJSON<AdminUser>("/admin/users", { method: "POST", body: input })
      setOpen(false)
      reset()
      toast.success(`${displayName} created`)
      await onCreated()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not create user."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          New user
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Create a DisCloud account. The user must change the temporary password after signing in.</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="admin-create-name">Name</FieldLabel>
            <Input id="admin-create-name" autoFocus maxLength={100} value={name} disabled={pending} onChange={(event) => setName(event.target.value)} />
            <FieldDescription>Display name shown throughout DisCloud.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="admin-create-username">Username</FieldLabel>
            <Input id="admin-create-username" value={username} disabled={pending} onChange={(event) => setUsername(event.target.value)} />
          </Field>

          <Field>
            <FieldLabel htmlFor="admin-create-password">Temporary password</FieldLabel>
            <Input id="admin-create-password" type="password" required minLength={temporaryPasswordMinLength} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
            <FieldDescription>Use at least {temporaryPasswordMinLength} characters. The user must choose a new password after signing in.</FieldDescription>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="admin-create-role">Role</FieldLabel>
              <Select value={role} disabled={pending} onValueChange={(value) => setRole(value as AdminRole)}>
                <SelectTrigger id="admin-create-role" className="w-full">
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
            </Field>

            <Field>
              <FieldLabel htmlFor="admin-create-quota">Quota (GiB)</FieldLabel>
              <Input id="admin-create-quota" type="number" min="0" step="0.1" placeholder="Unlimited" value={quotaGiB} disabled={pending} onChange={(event) => setQuotaGiB(event.target.value)} />
            </Field>
          </div>

          <FieldDescription>Leave empty for unlimited storage.</FieldDescription>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void create()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
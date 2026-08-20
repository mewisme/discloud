"use client"

import { useState } from "react"
import { KeyRoundIcon, Loader2Icon, PlusIcon, RefreshCwIcon, Settings2Icon, UserCheckIcon, UserXIcon } from "lucide-react"
import { toast } from "sonner"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, CreateUserInput, QuotaReconciliationPage, ReconcileQuotaInput, ResetUserPasswordInput, SetUserQuotaInput, UpdateUserInput } from "@/lib/api/models"
import { apiErrorMessage, formatBytes } from "@/lib/helpers"

const gib = 1024 ** 3

export function CreateUserDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"user" | "admin">("user")
  const [quotaGiB, setQuotaGiB] = useState("")
  const [pending, setPending] = useState(false)

  function reset() {
    setUsername("")
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
    const name = username.trim()
    if (!name) {
      toast.error("Username is required")
      return
    }
    if (!password) {
      toast.error("Password is required")
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
      const input: CreateUserInput = {
        username: name,
        password,
        role,
        ...(quota === undefined ? {} : { storageQuotaBytes: quota }),
      }
      await apiJSON<AdminUser>("/admin/users", { method: "POST", body: input })
      setOpen(false)
      reset()
      toast.success(`${name} created`)
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
            <FieldLabel htmlFor="admin-create-username">Username</FieldLabel>
            <Input id="admin-create-username" autoFocus value={username} disabled={pending} onChange={(event) => setUsername(event.target.value)} />
          </Field>

          <Field>
            <FieldLabel htmlFor="admin-create-password">Temporary password</FieldLabel>
            <Input id="admin-create-password" type="password" value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Role</FieldLabel>
              <Select value={role} disabled={pending} onValueChange={(value) => setRole(value as "user" | "admin")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="admin-create-quota">Quota (GiB)</FieldLabel>
              <Input id="admin-create-quota" type="number" min="0" step="10" placeholder="Unlimited" value={quotaGiB} disabled={pending} onChange={(event) => setQuotaGiB(event.target.value)} />
            </Field>
          </div>
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

export function ManageUserDialog({
  user,
  currentUserId,
  onUpdated,
}: {
  user: AdminUser
  currentUserId: string
  onUpdated: (user: AdminUser) => void
}) {
  const self = user.id === currentUserId
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState(user.username)
  const [role, setRole] = useState<"user" | "admin">(user.role)
  const [unlimited, setUnlimited] = useState(user.storageQuotaBytes === null)
  const [quotaGiB, setQuotaGiB] = useState(formatQuotaGiB(user.storageQuotaBytes))
  const [password, setPassword] = useState("")
  const [accountPending, setAccountPending] = useState(false)
  const [quotaPending, setQuotaPending] = useState(false)
  const [passwordPending, setPasswordPending] = useState(false)
  const [statusPending, setStatusPending] = useState(false)
  const pending = accountPending || quotaPending || passwordPending || statusPending

  function sync(next: AdminUser) {
    setUsername(next.username)
    setRole(next.role)
    setUnlimited(next.storageQuotaBytes === null)
    setQuotaGiB(formatQuotaGiB(next.storageQuotaBytes))
    onUpdated(next)
  }

  function reset() {
    setUsername(user.username)
    setRole(user.role)
    setUnlimited(user.storageQuotaBytes === null)
    setQuotaGiB(formatQuotaGiB(user.storageQuotaBytes))
    setPassword("")
  }

  function handleOpenChange(next: boolean) {
    if (pending) return
    if (next) reset()
    setOpen(next)
  }

  async function refreshUser() {
    const refreshed = await apiJSON<AdminUser>(`/admin/users/${encodeURIComponent(user.id)}`)
    sync(refreshed)
    return refreshed
  }

  async function saveAccount() {
    const name = username.trim()
    if (!name) {
      toast.error("Username is required")
      return
    }

    const input: UpdateUserInput = {}
    if (name !== user.username) input.username = name
    if (!self && role !== user.role) input.role = role

    if (Object.keys(input).length === 0) {
      toast.info("No account changes to save")
      return
    }

    setAccountPending(true)

    try {
      const updated = await apiJSON<AdminUser>(`/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: input,
      })
      sync(updated)
      toast.success("Account updated")
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update this user."))
    } finally {
      setAccountPending(false)
    }
  }

  async function saveQuota() {
    let storageQuotaBytes: number | null

    if (unlimited) {
      storageQuotaBytes = null
    } else {
      try {
        const value = parseQuotaGiB(quotaGiB)
        if (value === undefined) {
          toast.error("Enter a quota or select Unlimited")
          return
        }
        storageQuotaBytes = value
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Invalid storage quota")
        return
      }
    }

    setQuotaPending(true)

    try {
      const input: SetUserQuotaInput = { storageQuotaBytes }
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/quota`, { method: "PUT", body: input })
      const refreshed = await refreshUser()
      toast.success(refreshed.storageQuotaBytes === null ? "Storage quota removed" : `Storage quota set to ${formatBytes(refreshed.storageQuotaBytes)}`)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update storage quota."))
    } finally {
      setQuotaPending(false)
    }
  }

  async function resetPassword() {
    if (!password) {
      toast.error("Temporary password is required")
      return
    }

    setPasswordPending(true)

    try {
      const input: ResetUserPasswordInput = { password }
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, { method: "POST", body: input })
      await refreshUser()
      setPassword("")
      toast.success("Password reset. Existing sessions were revoked.")
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not reset this password."))
    } finally {
      setPasswordPending(false)
    }
  }

  async function changeStatus() {
    const enable = user.status !== "active"
    setStatusPending(true)

    try {
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/${enable ? "enable" : "disable"}`, { method: "POST" })
      await refreshUser()
      toast.success(`${user.username} ${enable ? "enabled" : "disabled"}`)
    } catch (error) {
      toast.error(apiErrorMessage(error, `Could not ${enable ? "enable" : "disable"} this user.`))
    } finally {
      setStatusPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Settings2Icon />
          Manage
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage {user.username}</DialogTitle>
          <DialogDescription>Update account access, storage quota, and authentication settings.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] space-y-6 pr-1">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Account</h3>
              <p className="text-xs text-muted-foreground">Change the username or account role.</p>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`admin-username-${user.id}`}>Username</FieldLabel>
                <Input id={`admin-username-${user.id}`} value={username} disabled={accountPending} onChange={(event) => setUsername(event.target.value)} />
              </Field>

              <Field>
                <FieldLabel>Role</FieldLabel>
                <Select value={role} disabled={accountPending || self} onValueChange={(value) => setRole(value as "user" | "admin")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                {self && <FieldDescription>Change your own role from another administrator account.</FieldDescription>}
              </Field>

              <Button className="self-start" disabled={accountPending} onClick={() => void saveAccount()}>
                {accountPending && <Loader2Icon className="animate-spin" />}
                Save account
              </Button>
            </FieldGroup>
          </section>

          <Separator />

          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Storage quota</h3>
              <p className="text-xs text-muted-foreground">
                Current usage: {formatBytes(user.storageUsedBytes)}
                {user.storageReservedBytes > 0 && ` + ${formatBytes(user.storageReservedBytes)} reserved`}
              </p>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel>
                  <Checkbox checked={unlimited} disabled={quotaPending} onCheckedChange={(value) => setUnlimited(value === true)} />
                  Unlimited storage
                </FieldLabel>
              </Field>

              <Field data-disabled={unlimited}>
                <FieldLabel htmlFor={`admin-quota-${user.id}`}>Quota (GiB)</FieldLabel>
                <Input id={`admin-quota-${user.id}`} type="number" min="0" step="0.1" value={quotaGiB} disabled={quotaPending || unlimited} onChange={(event) => setQuotaGiB(event.target.value)} />
              </Field>

              <Button className="self-start" disabled={quotaPending} onClick={() => void saveQuota()}>
                {quotaPending && <Loader2Icon className="animate-spin" />}
                Save quota
              </Button>
            </FieldGroup>
          </section>

          <Separator />

          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Reset password</h3>
              <p className="text-xs text-muted-foreground">
                Resetting a password revokes the user&apos;s existing sessions and requires a password change on the next sign-in.
              </p>
            </div>

            <Field>
              <FieldLabel htmlFor={`admin-password-${user.id}`}>Temporary password</FieldLabel>
              <Input id={`admin-password-${user.id}`} type="password" value={password} disabled={passwordPending || self} onChange={(event) => setPassword(event.target.value)} />
              {self && <FieldDescription>Use Security settings to change your own password.</FieldDescription>}
            </Field>

            <Button variant="outline" disabled={passwordPending || self} onClick={() => void resetPassword()}>
              {passwordPending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
              Reset password
            </Button>
          </section>

          <Separator />

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Account status</h3>
              <p className="text-xs text-muted-foreground">
                This account is currently <span className="font-medium capitalize text-foreground">{user.status}</span>.
              </p>
            </div>

            {user.status === "active" ? (
              <Button variant="destructive" disabled={statusPending || self} onClick={() => void changeStatus()}>
                {statusPending ? <Loader2Icon className="animate-spin" /> : <UserXIcon />}
                Disable account
              </Button>
            ) : (
              <Button variant="outline" disabled={statusPending} onClick={() => void changeStatus()}>
                {statusPending ? <Loader2Icon className="animate-spin" /> : <UserCheckIcon />}
                Enable account
              </Button>
            )}

            {self && <p className="text-xs text-muted-foreground">The current administrator account cannot be disabled here.</p>}
          </section>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReconcileQuotaDialog({ onReconciled }: { onReconciled: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function reconcile() {
    setPending(true)

    try {
      const input = {} satisfies ReconcileQuotaInput
      const result = await apiJSON<QuotaReconciliationPage>("/admin/storage/reconcile", {
        method: "POST",
        body: input,
      })
      const changed = result.users.filter((user) => user.changed).length
      const overQuota = result.users.filter((user) => user.overQuota).length

      setOpen(false)
      toast.success(
        changed === 0
          ? "Storage quota cache is already consistent"
          : `Reconciled ${changed} user${changed === 1 ? "" : "s"}${overQuota > 0 ? ` · ${overQuota} over quota` : ""}`,
      )
      await onReconciled()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not reconcile storage quota."))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => {
      if (!pending) setOpen(next)
    }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <RefreshCwIcon />
          Reconcile quota
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
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
      </AlertDialogContent>
    </AlertDialog>
  )
}

function parseQuotaGiB(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Quota must be a non-negative number")

  const bytes = Math.round(amount * gib)
  if (!Number.isSafeInteger(bytes)) throw new Error("Quota is too large")
  return bytes
}

function formatQuotaGiB(bytes: number | null) {
  if (bytes === null) return ""
  const value = bytes / gib
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "")
}
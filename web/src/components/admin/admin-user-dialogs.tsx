"use client"

import { HardDriveIcon, KeyRoundIcon, Loader2Icon, MoreHorizontalIcon, PencilIcon, PlusIcon, RefreshCwIcon, UserCheckIcon, UserXIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, CreateUserInput, QuotaReconciliationPage, ReconcileQuotaInput, ResetUserPasswordInput, SetUserQuotaInput, UpdateUserInput } from "@/lib/api/models"
import { apiErrorMessage, formatBytes } from "@/lib/helpers"

const gib = 1024 ** 3
type UserAction = "account" | "quota" | "password" | "status" | null
type AdminRole = AdminUser["role"]

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

    if (!password) {
      toast.error("Temporary password is required")
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
            <Input id="admin-create-password" type="password" required minLength={1} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
            <FieldDescription>Temporary passwords only need 1 character. The user must choose a new password after signing in.</FieldDescription>
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

export function UserActions({
  user,
  currentUserId,
  onUpdated,
}: {
  user: AdminUser
  currentUserId: string
  onUpdated: (user: AdminUser) => void
}) {
  const [action, setAction] = useState<UserAction>(null)
  const self = user.id === currentUserId

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${user.username}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-full">
          <DropdownMenuItem onSelect={() => setAction("account")}>
            <PencilIcon />
            Edit account
          </DropdownMenuItem>

          <DropdownMenuItem onSelect={() => setAction("quota")}>
            <HardDriveIcon />
            Storage quota
          </DropdownMenuItem>

          <DropdownMenuItem disabled={self} onSelect={() => setAction("password")}>
            <KeyRoundIcon />
            Reset password
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {user.status === "active" ? (
            <DropdownMenuItem variant="destructive" disabled={self} onSelect={() => setAction("status")}>
              <UserXIcon />
              Disable account
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setAction("status")}>
              <UserCheckIcon />
              Enable account
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditAccountDialog user={user} self={self} open={action === "account"} onOpenChange={(open) => setAction(open ? "account" : null)} onUpdated={onUpdated} />
      <QuotaDialog user={user} open={action === "quota"} onOpenChange={(open) => setAction(open ? "quota" : null)} onUpdated={onUpdated} />
      <ResetPasswordDialog user={user} open={action === "password"} onOpenChange={(open) => setAction(open ? "password" : null)} onUpdated={onUpdated} />
      <AccountStatusDialog user={user} open={action === "status"} onOpenChange={(open) => setAction(open ? "status" : null)} onUpdated={onUpdated} />
    </>
  )
}

function EditAccountDialog({
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
      const updated = await apiJSON<AdminUser>(`/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: input,
      })
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
          <DialogDescription>Update the display name and role for @{user.username}. Username is permanent.</DialogDescription>
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

function QuotaDialog({
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
      toast.success(updated.storageQuotaBytes === null ? "Storage quota removed" : `Storage quota set to ${formatBytes(updated.storageQuotaBytes)}`)
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
            {user.username} currently uses {formatBytes(user.storageUsedBytes)}
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

function ResetPasswordDialog({
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
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, {
        method: "POST",
        body: input,
      })
      onUpdated(await getAdminUser(user.id))
      onOpenChange(false)
      setPassword("")
      toast.success("Password reset. Existing sessions were revoked.")
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
            Set a temporary password for {user.username}. Existing sessions will be revoked and the user must change the password after signing in.
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

function AccountStatusDialog({
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
  const [pending, setPending] = useState(false)
  const enable = user.status !== "active"

  async function changeStatus() {
    setPending(true)

    try {
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/${enable ? "enable" : "disable"}`, { method: "POST" })
      onUpdated(await getAdminUser(user.id))
      onOpenChange(false)
      toast.success(`${user.username} ${enable ? "enabled" : "disabled"}`)
    } catch (error) {
      toast.error(apiErrorMessage(error, `Could not ${enable ? "enable" : "disable"} this user.`))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => {
      if (!pending) onOpenChange(next)
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{enable ? "Enable" : "Disable"} {user.username}?</AlertDialogTitle>
          <AlertDialogDescription>
            {enable
              ? "This account will be allowed to sign in and use DisCloud again."
              : "This account will no longer be allowed to sign in until an administrator enables it again."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant={enable ? "default" : "destructive"} disabled={pending} onClick={() => void changeStatus()}>
            {pending ? <Loader2Icon className="animate-spin" /> : enable ? <UserCheckIcon /> : <UserXIcon />}
            {enable ? "Enable account" : "Disable account"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

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
      const nextResult = await apiJSON<QuotaReconciliationPage>("/admin/storage/reconcile", {
        method: "POST",
        body: input,
      })
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

async function getAdminUser(userId: string) {
  return apiJSON<AdminUser>(`/admin/users/${encodeURIComponent(userId)}`)
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
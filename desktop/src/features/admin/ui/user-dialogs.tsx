import type { AdminUser, CreateUserInput, ResetUserPasswordInput, SetUserQuotaInput, UpdateUserInput } from "@discloud/api/models"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Checkbox } from "@discloud/ui/components/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { HardDriveIcon, KeyRoundIcon, Loader2Icon, MoreHorizontalIcon, PencilIcon, PlusIcon, UserCheckIcon, UserXIcon } from "lucide-react"
import { type ComponentProps, useState } from "react"

import { errorMessage } from "#lib/instance"

import { createAdminUser, resetAdminUserPassword, setAdminUserEnabled, setAdminUserQuota, updateAdminUser } from "../core/api"
import { formatBytes, formatQuotaGiB, parseQuotaGiB, temporaryPasswordMinLength, validateTemporaryPassword } from "../core/format"

type UserAction = "edit" | "quota" | "password" | "status"

export function CreateAdminUserDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<AdminUser["role"]>("user")
  const [quotaGiB, setQuotaGiB] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  function reset() {
    setName("")
    setUsername("")
    setPassword("")
    setRole("user")
    setQuotaGiB("")
    setError(undefined)
  }

  async function create() {
    const displayName = name.trim()
    const accountUsername = username.trim()

    if (!displayName) return setError("Name is required.")
    if (!accountUsername) return setError("Username is required.")

    const passwordError = validateTemporaryPassword(password)
    if (passwordError) return setError(passwordError)

    let quota: number | undefined
    try {
      quota = parseQuotaGiB(quotaGiB)
    } catch (cause) {
      return setError(errorMessage(cause))
    }

    setPending(true)
    setError(undefined)

    try {
      const input = {
        name: displayName,
        username: accountUsername,
        password,
        role,
        ...(quota === undefined ? {} : { storageQuotaBytes: quota }),
      } satisfies CreateUserInput

      await createAdminUser(input)
      setOpen(false)
      reset()
      await onCreated()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (pending) return
      setOpen(next)
      if (!next) reset()
    }}>
      <DialogTrigger asChild><Button><PlusIcon />New user</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Create a DisCloud account with a temporary password.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <LabeledInput label="Name" value={name} disabled={pending} autoFocus maxLength={100} onChange={setName} />
          <LabeledInput label="Username" value={username} disabled={pending} onChange={setUsername} />
          <LabeledInput label="Temporary password" type="password" value={password} disabled={pending} minLength={temporaryPasswordMinLength} onChange={setPassword} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={role} disabled={pending} onValueChange={(value) => setRole(value as AdminUser["role"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <LabeledInput label="Quota (GiB)" type="number" min="0" step="0.1" placeholder="Unlimited" value={quotaGiB} disabled={pending} onChange={setQuotaGiB} />
          </div>
        </div>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void create()}>{pending ? <Loader2Icon className="animate-spin" /> : null}Create user</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminUserActions({ user, currentUserId, onUpdated }: { user: AdminUser; currentUserId: string; onUpdated: (user: AdminUser) => void }) {
  const [action, setAction] = useState<UserAction>()
  const self = user.id === currentUserId

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Actions for ${user.name}`}><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setAction("edit")}><PencilIcon />Edit account</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAction("quota")}><HardDriveIcon />Storage quota</DropdownMenuItem>
          <DropdownMenuItem disabled={self} onSelect={() => setAction("password")}><KeyRoundIcon />Reset password</DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.status === "active"
            ? <DropdownMenuItem variant="destructive" disabled={self} onSelect={() => setAction("status")}><UserXIcon />Disable account</DropdownMenuItem>
            : <DropdownMenuItem onSelect={() => setAction("status")}><UserCheckIcon />Enable account</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>

      {action === "edit" ? <EditUserDialog user={user} self={self} onClose={() => setAction(undefined)} onUpdated={onUpdated} /> : null}
      {action === "quota" ? <QuotaDialog user={user} onClose={() => setAction(undefined)} onUpdated={onUpdated} /> : null}
      {action === "password" ? <PasswordDialog user={user} onClose={() => setAction(undefined)} onUpdated={onUpdated} /> : null}
      {action === "status" ? <StatusDialog user={user} onClose={() => setAction(undefined)} onUpdated={onUpdated} /> : null}
    </>
  )
}

function EditUserDialog({ user, self, onClose, onUpdated }: { user: AdminUser; self: boolean; onClose: () => void; onUpdated: (user: AdminUser) => void }) {
  const [name, setName] = useState(user.name)
  const [role, setRole] = useState<AdminUser["role"]>(user.role)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function save() {
    const displayName = name.trim()
    if (!displayName) return setError("Name is required.")

    const input = {
      ...(displayName !== user.name ? { name: displayName } : {}),
      ...(!self && role !== user.role ? { role } : {}),
    } satisfies UpdateUserInput

    if (!Object.keys(input).length) return onClose()

    setPending(true)
    setError(undefined)
    try {
      onUpdated(await updateAdminUser(user.id, input))
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit account</DialogTitle><DialogDescription>Username is permanent.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <LabeledInput label="Name" value={name} disabled={pending} maxLength={100} onChange={setName} />
          <LabeledInput label="Username" value={user.username} disabled onChange={() => undefined} />
          <div className="grid gap-2">
            <label className="text-sm font-medium">Role</label>
            <Select value={role} disabled={pending || self} onValueChange={(value) => setRole(value as AdminUser["role"])}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="user">User</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
            </Select>
            {self ? <p className="text-xs text-muted-foreground">Use another administrator account to change your own role.</p> : null}
          </div>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={() => void save()}>{pending ? <Loader2Icon className="animate-spin" /> : null}Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QuotaDialog({ user, onClose, onUpdated }: { user: AdminUser; onClose: () => void; onUpdated: (user: AdminUser) => void }) {
  const [unlimited, setUnlimited] = useState(user.storageQuotaBytes === null)
  const [quotaGiB, setQuotaGiB] = useState(formatQuotaGiB(user.storageQuotaBytes))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function save() {
    let storageQuotaBytes: number | null

    try {
      if (unlimited) storageQuotaBytes = null
      else {
        const quota = parseQuotaGiB(quotaGiB)
        if (quota === undefined) throw new Error("Enter a quota or select Unlimited")
        storageQuotaBytes = quota
      }
    } catch (cause) {
      return setError(errorMessage(cause))
    }

    setPending(true)
    setError(undefined)
    try {
      const input = { storageQuotaBytes } satisfies SetUserQuotaInput
      onUpdated(await setAdminUserQuota(user.id, input))
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Storage quota</DialogTitle><DialogDescription>{user.name} currently uses {formatBytes(user.storageUsedBytes)}.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={unlimited} disabled={pending} onCheckedChange={(value) => setUnlimited(value === true)} />Unlimited storage</label>
          <LabeledInput label="Quota (GiB)" type="number" min="0" step="0.1" value={quotaGiB} disabled={pending || unlimited} onChange={setQuotaGiB} />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={() => void save()}>{pending ? <Loader2Icon className="animate-spin" /> : null}Save quota</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PasswordDialog({ user, onClose, onUpdated }: { user: AdminUser; onClose: () => void; onUpdated: (user: AdminUser) => void }) {
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function reset() {
    const validation = validateTemporaryPassword(password)
    if (validation) return setError(validation)

    setPending(true)
    setError(undefined)
    try {
      const input = { password } satisfies ResetUserPasswordInput
      onUpdated(await resetAdminUserPassword(user.id, input))
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset password</DialogTitle><DialogDescription>Existing sessions will be revoked and the user must change this temporary password after signing in.</DialogDescription></DialogHeader>
        <LabeledInput label="Temporary password" type="password" value={password} disabled={pending} minLength={temporaryPasswordMinLength} onChange={setPassword} />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={() => void reset()}>{pending ? <Loader2Icon className="animate-spin" /> : null}Reset password</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StatusDialog({ user, onClose, onUpdated }: { user: AdminUser; onClose: () => void; onUpdated: (user: AdminUser) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const enable = user.status !== "active"

  async function change() {
    setPending(true)
    setError(undefined)
    try {
      onUpdated(await setAdminUserEnabled(user.id, enable))
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{enable ? "Enable" : "Disable"} {user.name}?</AlertDialogTitle><AlertDialogDescription>{enable ? "This account will be allowed to sign in again." : "This account will not be allowed to sign in until an administrator enables it again."}</AlertDialogDescription></AlertDialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><Button variant={enable ? "default" : "destructive"} disabled={pending} onClick={() => void change()}>{pending ? <Loader2Icon className="animate-spin" /> : enable ? <UserCheckIcon /> : <UserXIcon />}{enable ? "Enable account" : "Disable account"}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function LabeledInput({ label, value, onChange, ...props }: { label: string; value: string; onChange: (value: string) => void } & Omit<ComponentProps<typeof Input>, "value" | "onChange">) {
  return <div className="grid gap-2"><label className="text-sm font-medium">{label}</label><Input value={value} onChange={(event) => onChange(event.target.value)} {...props} /></div>
}

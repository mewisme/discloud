"use client"

import { useState } from "react"
import { DatabaseIcon, FileIcon, HardDriveIcon, Loader2Icon, PlusIcon, ShieldCheckIcon, UserCheckIcon, UserRoundIcon, UserXIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, AdminUsers, CreateUserInput, ListUsersQuery, StorageOverview } from "@/lib/api/models"
import { apiErrorMessage, formatBytes, formatNumber } from "@/lib/helpers"

const pageSize = 50
const gib = 1024 ** 3

export function AdminView({
  initialUsers,
  initialStorage,
  currentUserId,
}: {
  initialUsers: AdminUsers
  initialStorage: StorageOverview
  currentUserId: string
}) {
  const [users, setUsers] = useState<AdminUser[]>(() => [...initialUsers.users])
  const [total, setTotal] = useState(initialUsers.total)
  const [offset, setOffset] = useState(initialUsers.offset)
  const [storage, setStorage] = useState(initialStorage)
  const [loading, setLoading] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<string>()

  async function loadUsers(nextOffset: number) {
    if (loading) return
    setLoading(true)

    try {
      const query = { limit: pageSize, offset: nextOffset } satisfies ListUsersQuery
      const page = await apiJSON<AdminUsers>("/admin/users", { query })
      setUsers([...page.users])
      setTotal(page.total)
      setOffset(page.offset)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load users."))
    } finally {
      setLoading(false)
    }
  }

  async function reloadStorage() {
    try {
      setStorage(await apiJSON<StorageOverview>("/admin/storage"))
    } catch {
      toast.error("User updated, but storage overview could not refresh")
    }
  }

  async function setUserEnabled(user: AdminUser, enabled: boolean) {
    if (pendingUserId) return
    setPendingUserId(user.id)

    try {
      await apiJSON<void>(`/admin/users/${encodeURIComponent(user.id)}/${enabled ? "enable" : "disable"}`, { method: "POST" })
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, status: enabled ? "active" : "disabled" } : item))
      toast.success(`${user.username} ${enabled ? "enabled" : "disabled"}`)
    } catch (error) {
      toast.error(apiErrorMessage(error, `Could not ${enabled ? "enable" : "disable"} this user.`))
    } finally {
      setPendingUserId(undefined)
    }
  }

  async function userCreated() {
    await Promise.all([loadUsers(0), reloadStorage()])
  }

  const previousDisabled = offset === 0 || loading
  const nextDisabled = offset + users.length >= total || loading

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-6" />
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Manage users and inspect DisCloud storage state.</p>
        </div>
        <CreateUserDialog onCreated={userCreated} />
      </div>

      <StorageOverviewCards storage={storage} />

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Users</h2>
            <p className="text-sm text-muted-foreground">{formatNumber(total)} account{total === 1 ? "" : "s"}</p>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Loading…
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="hidden w-24 sm:table-cell">Role</TableHead>
                <TableHead className="hidden w-28 md:table-cell">Status</TableHead>
                <TableHead className="hidden lg:table-cell">Storage</TableHead>
                <TableHead className="hidden xl:table-cell">Quota</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const committed = user.storageUsedBytes + user.storageReservedBytes
                const quotaPercent = user.storageQuotaBytes === null
                  ? 0
                  : Math.min(100, user.storageQuotaBytes === 0 ? 100 : committed / user.storageQuotaBytes * 100)
                const pending = pendingUserId === user.id
                const self = user.id === currentUserId

                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                          {user.role === "admin" ? <ShieldCheckIcon className="size-4" /> : <UserRoundIcon className="size-4" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium">{user.username}</p>
                            {self && <Badge variant="secondary">You</Badge>}
                          </div>
                          {user.mustChangePassword && <p className="text-xs text-muted-foreground">Password change required</p>}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="capitalize">{user.role}</Badge>
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      <Badge variant={user.status === "active" ? "secondary" : "outline"} className="capitalize">
                        {user.status}
                      </Badge>
                    </TableCell>

                    <TableCell className="hidden lg:table-cell">
                      <div className="min-w-40 space-y-1.5">
                        <div className="text-sm tabular-nums">
                          {formatBytes(user.storageUsedBytes)}
                          {user.storageReservedBytes > 0 && <span className="text-muted-foreground"> + {formatBytes(user.storageReservedBytes)} reserved</span>}
                        </div>
                        {user.storageQuotaBytes !== null && <Progress value={quotaPercent} className="h-1.5" />}
                      </div>
                    </TableCell>

                    <TableCell className="hidden tabular-nums text-muted-foreground xl:table-cell">
                      {user.storageQuotaBytes === null ? "Unlimited" : formatBytes(user.storageQuotaBytes)}
                    </TableCell>

                    <TableCell>
                      <div className="flex justify-end">
                        {user.status === "active" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending || self}
                            title={self ? "You cannot disable your current account here" : undefined}
                            onClick={() => void setUserEnabled(user, false)}
                          >
                            {pending ? <Loader2Icon className="animate-spin" /> : <UserXIcon />}
                            Disable
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => void setUserEnabled(user, true)}>
                            {pending ? <Loader2Icon className="animate-spin" /> : <UserCheckIcon />}
                            Enable
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
            <p className="text-xs text-muted-foreground">
              {total === 0 ? "No users" : `${offset + 1}–${Math.min(offset + users.length, total)} of ${total}`}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={previousDisabled} onClick={() => void loadUsers(Math.max(0, offset - pageSize))}>Previous</Button>
              <Button size="sm" variant="outline" disabled={nextDisabled} onClick={() => void loadUsers(offset + pageSize)}>Next</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function StorageOverviewCards({ storage }: { storage: StorageOverview }) {
  const logicalMismatch = storage.derivedLogicalUsedBytes !== storage.cachedLogicalUsedBytes
  const reservedMismatch = storage.derivedReservedBytes !== storage.cachedReservedBytes

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={<UsersIcon />} label="Users" value={formatNumber(storage.userCount)} detail={`${formatNumber(storage.activeFileCount)} active files`} />
      <MetricCard
        icon={<HardDriveIcon />}
        label="Logical storage"
        value={formatBytes(storage.derivedLogicalUsedBytes)}
        detail={logicalMismatch ? `Cached ${formatBytes(storage.cachedLogicalUsedBytes)} · mismatch` : "Quota cache matches"}
        warning={logicalMismatch}
      />
      <MetricCard
        icon={<DatabaseIcon />}
        label="Unique chunks"
        value={formatBytes(storage.uniqueChunkBytes)}
        detail={`${formatNumber(storage.uniqueChunkCount)} chunks · ${formatNumber(storage.readyChunkCount)} ready`}
      />
      <MetricCard
        icon={<FileIcon />}
        label="Reserved"
        value={formatBytes(storage.derivedReservedBytes)}
        detail={reservedMismatch || storage.quotaMismatchUsers > 0
          ? `${formatNumber(storage.quotaMismatchUsers)} quota mismatch users`
          : `${formatBytes(storage.orphanCandidateChunkBytes)} orphan candidates`}
        warning={reservedMismatch || storage.quotaMismatchUsers > 0}
      />
    </div>
  )
}

function MetricCard({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warning?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <div className={warning ? "text-destructive [&>svg]:size-4" : "text-muted-foreground [&>svg]:size-4"}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <p className={warning ? "mt-1 text-xs text-destructive" : "mt-1 text-xs text-muted-foreground"}>{detail}</p>
      </CardContent>
    </Card>
  )
}

function CreateUserDialog({ onCreated }: { onCreated: () => Promise<void> }) {
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

  function changeOpen(next: boolean) {
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
    if (quotaGiB.trim()) {
      const value = Number(quotaGiB)
      if (!Number.isFinite(value) || value < 0) {
        toast.error("Quota must be a non-negative number")
        return
      }
      quota = Math.round(value * gib)
      if (!Number.isSafeInteger(quota)) {
        toast.error("Quota is too large")
        return
      }
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
      changeOpen(false)
      toast.success(`${name} created`)
      await onCreated()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not create user."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          New user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Create a DisCloud account. The user must change this password after signing in.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="admin-create-username" className="text-sm font-medium">Username</label>
            <Input id="admin-create-username" autoFocus value={username} disabled={pending} onChange={(event) => setUsername(event.target.value)} />
          </div>

          <div className="space-y-2">
            <label htmlFor="admin-create-password" className="text-sm font-medium">Temporary password</label>
            <Input id="admin-create-password" type="password" value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="admin-create-role" className="text-sm font-medium">Role</label>
              <select
                id="admin-create-role"
                value={role}
                disabled={pending}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                onChange={(event) => setRole(event.target.value as "user" | "admin")}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="admin-create-quota" className="text-sm font-medium">Quota (GiB)</label>
              <Input id="admin-create-quota" type="number" min="0" step="0.1" placeholder="Unlimited" value={quotaGiB} disabled={pending} onChange={(event) => setQuotaGiB(event.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void create()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
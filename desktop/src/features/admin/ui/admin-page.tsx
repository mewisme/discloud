import type { AdminUser, ListUsersQuery, QuotaReconciliationPage, StorageOverview } from "@discloud/api/models"
import { AdminPageHeader } from "@discloud/app-ui/admin/admin-page-header"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { Progress } from "@discloud/ui/components/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { DatabaseIcon, FileIcon, HardDriveIcon, Loader2Icon, RefreshCwIcon, TriangleAlertIcon, UsersIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { useDesktopSession } from "#components/desktop-session"
import { errorMessage } from "#lib/instance"

import { DesktopUserAvatar } from "../../avatar/ui/user-avatar"
import { loadAdminUsers, loadStorageOverview, reconcileStorageQuota } from "../core/api"
import { formatBytes, formatNumber } from "../core/format"
import { AdminUserActions, CreateAdminUserDialog } from "./user-dialogs"

const pageSize = 50

export function DesktopAdminPage() {
  const { state, refreshUser } = useDesktopSession()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [storage, setStorage] = useState<StorageOverview>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const currentUserId = state.status === "connected" ? state.user?.id : undefined

  useEffect(() => {
    void load(0, true)
  }, [])

  async function load(nextOffset = offset, initial = false) {
    if (!currentUserId) return
    if (initial) setLoading(true)
    setError(undefined)

    try {
      const query = { limit: pageSize, offset: nextOffset } satisfies ListUsersQuery
      const [userPage, nextStorage] = await Promise.all([loadAdminUsers(query), loadStorageOverview()])
      setUsers([...userPage.users])
      setTotal(userPage.total)
      setOffset(userPage.offset)
      setStorage(nextStorage)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function loadUsers(nextOffset: number) {
    setLoading(true)
    setError(undefined)

    try {
      const query = { limit: pageSize, offset: nextOffset } satisfies ListUsersQuery
      const page = await loadAdminUsers(query)
      setUsers([...page.users])
      setTotal(page.total)
      setOffset(page.offset)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function reloadStorage() {
    try {
      setStorage(await loadStorageOverview())
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  function userUpdated(updated: AdminUser) {
    setUsers((current) => current.map((user) => user.id === updated.id ? updated : user))
    void reloadStorage()
    if (updated.id === currentUserId) void refreshUser()
  }

  if (loading && !storage) return <LoadingState label="Loading administration" />

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <AdminPageHeader action={<CreateAdminUserDialog onCreated={() => load(0)} />} />

      {error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Admin action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      {storage ? <StorageSection storage={storage} onChanged={() => load(offset)} /> : null}

      {currentUserId ? (
        <UsersTable users={users} total={total} offset={offset} currentUserId={currentUserId} loading={loading} onLoadPage={loadUsers} onUpdated={userUpdated} />
      ) : null}
    </div>
  )
}

function StorageSection({ storage, onChanged }: { storage: StorageOverview; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<QuotaReconciliationPage>()
  const [error, setError] = useState<string>()
  const logicalMismatch = storage.derivedLogicalUsedBytes !== storage.cachedLogicalUsedBytes
  const reservedMismatch = storage.derivedReservedBytes !== storage.cachedReservedBytes

  async function reconcile() {
    setPending(true)
    setError(undefined)

    try {
      setResult(await reconcileStorageQuota({}))
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-lg font-semibold">Storage</h2>
          <p className="text-sm text-muted-foreground">Logical usage, physical chunks, reservations, and quota consistency.</p>
        </div>
        <Button variant="outline" onClick={() => { setResult(undefined); setError(undefined); setOpen(true) }}><RefreshCwIcon />Reconcile quota</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<UsersIcon />} label="Users" value={formatNumber(storage.userCount)} detail={`${formatNumber(storage.activeFileCount)} active files`} />
        <MetricCard icon={<HardDriveIcon />} label="Logical storage" value={formatBytes(storage.derivedLogicalUsedBytes)} detail={logicalMismatch ? `Cached ${formatBytes(storage.cachedLogicalUsedBytes)} · mismatch` : "Quota cache matches"} warning={logicalMismatch} />
        <MetricCard icon={<DatabaseIcon />} label="Unique chunks" value={formatBytes(storage.uniqueChunkBytes)} detail={`${formatNumber(storage.uniqueChunkCount)} chunks · ${formatNumber(storage.readyChunkCount)} ready`} />
        <MetricCard icon={<FileIcon />} label="Reserved" value={formatBytes(storage.derivedReservedBytes)} detail={reservedMismatch || storage.quotaMismatchUsers > 0 ? `${formatNumber(storage.quotaMismatchUsers)} quota mismatch users` : `${formatBytes(storage.orphanCandidateChunkBytes)} orphan candidates`} warning={reservedMismatch || storage.quotaMismatchUsers > 0} />
      </div>

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{result ? "Quota reconciliation complete" : "Reconcile storage quota?"}</DialogTitle>
            <DialogDescription>{result ? `Checked ${result.users.length} accounts.` : "Recalculate used and reserved storage from canonical database state and repair cached counters."}</DialogDescription>
          </DialogHeader>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {result ? <ReconcileResult result={result} /> : null}

          <DialogFooter>
            {result ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={pending} onClick={() => void reconcile()}>{pending ? <Loader2Icon className="animate-spin" /> : null}Reconcile</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ReconcileResult({ result }: { result: QuotaReconciliationPage }) {
  const attention = result.users.filter((user) => user.changed || user.overQuota)

  if (!attention.length) {
    return <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">Storage quota counters were already consistent.</div>
  }

  return (
    <div className="max-h-80 space-y-2 overflow-y-auto">
      {attention.map((user) => (
        <div key={user.userId} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">@{user.username}</p>
            </div>
            <div className="flex gap-1">
              {user.changed ? <Badge variant="secondary">Repaired</Badge> : null}
              {user.overQuota ? <Badge variant="destructive">Over quota</Badge> : null}
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-md bg-muted/50 p-2">Used: {formatBytes(user.beforeUsedBytes)} → {formatBytes(user.afterUsedBytes)}</div>
            <div className="rounded-md bg-muted/50 p-2">Reserved: {formatBytes(user.beforeReservedBytes)} → {formatBytes(user.afterReservedBytes)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function UsersTable({
  users,
  total,
  offset,
  currentUserId,
  loading,
  onLoadPage,
  onUpdated,
}: {
  users: readonly AdminUser[]
  total: number
  offset: number
  currentUserId: string
  loading: boolean
  onLoadPage: (offset: number) => Promise<void>
  onUpdated: (user: AdminUser) => void
}) {
  const previousDisabled = offset === 0 || loading
  const nextDisabled = offset + users.length >= total || loading

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">{formatNumber(total)} account{total === 1 ? "" : "s"}</p>
        </div>
        {loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="hidden w-24 sm:table-cell">Role</TableHead>
              <TableHead className="hidden w-28 md:table-cell">Status</TableHead>
              <TableHead className="hidden w-48 lg:table-cell">Storage</TableHead>
              <TableHead className="hidden w-28 xl:table-cell">Quota</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {users.map((user) => {
              const committed = user.storageUsedBytes + user.storageReservedBytes
              const quotaPercent = user.storageQuotaBytes === null ? 0 : Math.min(100, user.storageQuotaBytes === 0 ? 100 : committed / user.storageQuotaBytes * 100)

              return (
                <TableRow key={user.id}>
                  <TableCell className="min-w-0 overflow-hidden">
                    <div className="flex min-w-0 items-center gap-3">
                      <DesktopUserAvatar user={user} adminUserId={user.id} className="size-8 shrink-0" />

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 flex-1 truncate font-medium" title={user.name}>{user.name}</p>
                          {user.id === currentUserId ? <Badge variant="secondary">You</Badge> : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground" title={`@${user.username}`}>@{user.username}</p>
                        {user.mustChangePassword ? <p className="truncate text-xs text-muted-foreground">Password change required</p> : null}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden sm:table-cell"><Badge variant="outline" className="capitalize">{user.role}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell"><Badge variant={user.status === "active" ? "secondary" : "outline"} className="capitalize">{user.status}</Badge></TableCell>

                  <TableCell className="hidden lg:table-cell">
                    <div className="min-w-40 space-y-1">
                      <p className="text-sm tabular-nums">
                        {formatBytes(user.storageUsedBytes)}
                        {user.storageReservedBytes > 0 ? <span className="text-muted-foreground"> + {formatBytes(user.storageReservedBytes)} reserved</span> : null}
                      </p>
                      {user.storageQuotaBytes !== null ? <Progress value={quotaPercent} className="h-1.5" /> : null}
                    </div>
                  </TableCell>

                  <TableCell className="hidden tabular-nums text-muted-foreground xl:table-cell">
                    {user.storageQuotaBytes === null ? "Unlimited" : formatBytes(user.storageQuotaBytes)}
                  </TableCell>

                  <TableCell><AdminUserActions user={user} currentUserId={currentUserId} onUpdated={onUpdated} /></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t px-3 py-2">
          <p className="text-xs text-muted-foreground">{total === 0 ? "No users" : `${offset + 1}–${Math.min(offset + users.length, total)} of ${total}`}</p>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={previousDisabled} onClick={() => void onLoadPage(Math.max(0, offset - pageSize))}>Previous</Button>
            <Button size="sm" variant="outline" disabled={nextDisabled} onClick={() => void onLoadPage(offset + pageSize)}>Next</Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function MetricCard({ icon, label, value, detail, warning = false }: { icon: ReactNode; label: string; value: string; detail: string; warning?: boolean }) {
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

function LoadingState({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="animate-spin" />
        {label}
      </div>
    </div>
  )
}
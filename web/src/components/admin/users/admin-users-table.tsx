import { Loader2Icon } from "lucide-react"

import { UserActions } from "@/components/admin/users/user-actions"
import { UserAvatar } from "@/components/common/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiURL } from "@/lib/api/client"
import type { AdminUser } from "@/lib/api/models"
import { formatBytes, formatNumber } from "@/lib/helpers"

export function AdminUsersTable({
  users,
  total,
  offset,
  pageSize,
  loading,
  currentUserId,
  onLoadPage,
  onUpdated,
}: {
  users: readonly AdminUser[]
  total: number
  offset: number
  pageSize: number
  loading: boolean
  currentUserId: string
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
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {users.map((user) => {
              const committed = user.storageUsedBytes + user.storageReservedBytes
              const quotaPercent = user.storageQuotaBytes === null
                ? 0
                : Math.min(100, user.storageQuotaBytes === 0 ? 100 : committed / user.storageQuotaBytes * 100)

              const avatarSrc = user.hasAvatar
                ? apiURL(`/admin/users/${encodeURIComponent(user.id)}/avatar`, { revision: user.avatarRevision })
                : undefined

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <UserAvatar className="size-8 shrink-0" name={user.name} username={user.username} src={avatarSrc} />

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">{user.name}</p>
                          <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                          {user.id === currentUserId && <Badge variant="secondary">You</Badge>}
                        </div>

                        {user.mustChangePassword && <p className="text-xs text-muted-foreground">Password change required</p>}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" className="capitalize">{user.role}</Badge>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <Badge variant={user.status === "active" ? "secondary" : "outline"} className="capitalize">{user.status}</Badge>
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
                      <UserActions user={user} currentUserId={currentUserId} onUpdated={onUpdated} />
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
            <Button size="sm" variant="outline" disabled={previousDisabled} onClick={() => void onLoadPage(Math.max(0, offset - pageSize))}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={nextDisabled} onClick={() => void onLoadPage(offset + pageSize)}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
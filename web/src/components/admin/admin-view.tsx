"use client"

import { ShieldCheckIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { ReconcileQuotaDialog } from "@/components/admin/storage/reconcile-quota-dialog"
import { StorageOverviewCards } from "@/components/admin/storage/storage-overview"
import { AdminUsersTable } from "@/components/admin/users/admin-users-table"
import { CreateUserDialog } from "@/components/admin/users/create-user-dialog"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser, AdminUsers, ListUsersQuery, StorageOverview } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

const pageSize = 50

export function AdminView({
  initialUsers,
  initialStorage,
  currentUserId,
}: {
  initialUsers: AdminUsers
  initialStorage: StorageOverview
  currentUserId: string
}) {
  const router = useRouter()
  const [users, setUsers] = useState<AdminUser[]>(() => [...initialUsers.users])
  const [total, setTotal] = useState(initialUsers.total)
  const [offset, setOffset] = useState(initialUsers.offset)
  const [storage, setStorage] = useState(initialStorage)
  const [loading, setLoading] = useState(false)

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
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not refresh storage overview."))
    }
  }

  async function userCreated() {
    await Promise.all([loadUsers(0), reloadStorage()])
  }

  async function reconciled() {
    await Promise.all([loadUsers(offset), reloadStorage()])
  }

  function userUpdated(updated: AdminUser) {
    setUsers((current) => current.map((user) => user.id === updated.id ? updated : user))
    void reloadStorage()

    if (updated.id === currentUserId) router.refresh()
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-6" />
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            Manage users and inspect DisCloud storage state.
          </p>
        </div>

        <CreateUserDialog onCreated={userCreated} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-semibold">Storage</h2>
            <p className="text-sm text-muted-foreground">
              Logical usage, physical chunks, reservations, and quota consistency.
            </p>
          </div>

          <ReconcileQuotaDialog onReconciled={reconciled} />
        </div>

        <StorageOverviewCards storage={storage} />
      </section>

      <AdminUsersTable
        users={users}
        total={total}
        offset={offset}
        pageSize={pageSize}
        loading={loading}
        currentUserId={currentUserId}
        onLoadPage={loadUsers}
        onUpdated={userUpdated}
      />
    </div>
  )
}
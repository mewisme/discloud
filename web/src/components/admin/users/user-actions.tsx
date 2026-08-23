"use client"

import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { HardDriveIcon, KeyRoundIcon, MoreHorizontalIcon, PencilIcon, UserCheckIcon, UserXIcon } from "lucide-react"
import { useState } from "react"

import { adminUserLabel } from "@/components/admin/users/admin-user-utils"
import { EditUserDialog } from "@/components/admin/users/edit-user-dialog"
import { ResetUserPasswordDialog } from "@/components/admin/users/reset-user-password-dialog"
import { UserQuotaDialog } from "@/components/admin/users/user-quota-dialog"
import { UserStatusDialog } from "@/components/admin/users/user-status-dialog"
import type { AdminUser } from "@/lib/api/models"

type UserAction = "account" | "quota" | "password" | "status" | null

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
          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${adminUserLabel(user)}`}>
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

      <EditUserDialog
        user={user}
        self={self}
        open={action === "account"}
        onOpenChange={(open) => setAction(open ? "account" : null)}
        onUpdated={onUpdated}
      />

      <UserQuotaDialog
        user={user}
        open={action === "quota"}
        onOpenChange={(open) => setAction(open ? "quota" : null)}
        onUpdated={onUpdated}
      />

      <ResetUserPasswordDialog
        user={user}
        open={action === "password"}
        onOpenChange={(open) => setAction(open ? "password" : null)}
        onUpdated={onUpdated}
      />

      <UserStatusDialog
        user={user}
        open={action === "status"}
        onOpenChange={(open) => setAction(open ? "status" : null)}
        onUpdated={onUpdated}
      />
    </>
  )
}
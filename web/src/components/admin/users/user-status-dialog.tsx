"use client"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, UserCheckIcon, UserXIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { adminUserLabel, getAdminUser } from "@/components/admin/users/admin-user-utils"
import { apiJSON } from "@/lib/api/client"
import type { AdminUser } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export function UserStatusDialog({
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
      toast.success(`${adminUserLabel(user)} ${enable ? "enabled" : "disabled"}`)
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
          <AlertDialogTitle>{enable ? "Enable" : "Disable"} {adminUserLabel(user)}?</AlertDialogTitle>
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
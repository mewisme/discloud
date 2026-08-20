"use client"

import { ChevronDownIcon, Loader2Icon, LogOutIcon, SettingsIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { CurrentUserAvatar } from "@/components/common/current-user-avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useSidebar } from "@/components/ui/sidebar"
import { apiJSON } from "@/lib/api/client"
import type { User } from "@/lib/api/models"

export function HeaderUserMenu({ user }: { user: User }) {
  const router = useRouter()
  const { setOpenMobile } = useSidebar()
  const [pending, setPending] = useState(false)

  async function logout() {
    setPending(true)

    try {
      await apiJSON<void>("/auth/logout", { method: "POST" })
      setOpenMobile(false)
      router.replace("/login")
      router.refresh()
    } catch {
      toast.error("Could not sign out")
      setPending(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 gap-2 rounded-lg px-1.5 sm:pr-2"
          aria-label={`Open ${user.username} menu`}
        >
          <CurrentUserAvatar className="size-6" />
          <span className="hidden max-w-32 truncate text-sm font-medium lg:inline">
            {user.username}
          </span>
          <ChevronDownIcon className="hidden size-3.5 text-muted-foreground lg:block" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3 py-1">
            <CurrentUserAvatar className="size-10" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {user.username}
              </p>
              <p className="truncate text-xs capitalize text-muted-foreground">
                {user.role}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/profile" onClick={() => setOpenMobile(false)}>
            <UserRoundIcon />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings/security" onClick={() => setOpenMobile(false)}>
            <ShieldCheckIcon />
            Security
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings" onClick={() => setOpenMobile(false)}>
            <SettingsIcon />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault()
            void logout()
          }}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
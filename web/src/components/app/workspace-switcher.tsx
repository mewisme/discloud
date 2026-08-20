"use client"

import { CheckIcon, ChevronsUpDownIcon, FolderRootIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { useCurrentUser } from "@/components/app/current-user-context"
import { useWorkspace } from "@/components/app/workspace-context"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSidebar } from "@/components/ui/sidebar"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"
import { type AdminDirectoryUser, listAdminUserDirectory } from "@/lib/users/admin-user-directory"
import { cn } from "@/lib/utils"
import { workspacePath, workspaceRelativePath } from "@/lib/workspace/navigation"

export function WorkspaceSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUser = useCurrentUser()
  const workspace = useWorkspace()
  const { setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open || loaded || loading || currentUser.role !== "admin") return

    const controller = new AbortController()
    setLoading(true)
    setError(undefined)

    void listAdminUserDirectory(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setUsers(items.filter((user) => user.status === "active"))
          setLoaded(true)
        }
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        if (cause instanceof APIError && cause.status === 401) {
          router.replace("/login")
          router.refresh()
          return
        }
        setError(apiErrorMessage(cause, "Could not load workspaces"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [currentUser.role, loaded, loading, open, router])

  function select(username: string) {
    if (username === workspace.username) {
      setOpen(false)
      return
    }

    const relative = workspaceRelativePath(pathname, workspace.username)
    let suffix = relative ?? ""

    if (suffix.startsWith("folders/") || suffix.startsWith("files/")) suffix = ""
    else if (suffix.startsWith("collections/") && suffix !== "collections") suffix = "collections"

    const path = workspacePath(username, suffix)
    const preserveQuery = suffix === relative && searchParams.size > 0
    const href = preserveQuery ? `${path}?${searchParams.toString()}` : path

    setOpen(false)
    setOpenMobile(false)
    router.push(href)
  }

  if (currentUser.role !== "admin") {
    return (
      <div className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm group-data-[collapsible=icon]:justify-center">
        <FolderRootIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate group-data-[collapsible=icon]:hidden">{workspace.username}&apos;s Workspace</span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-9 w-full justify-start gap-2 px-2 group-data-[collapsible=icon]:justify-center">
          <FolderRootIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:hidden">
            {workspace.username}&apos;s Workspace
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search workspaces…" />
          <CommandList>
            {loading && (
              <CommandItem disabled>
                <Loader2Icon className="animate-spin" />
                Loading workspaces…
              </CommandItem>
            )}
            {error && (
              <div className="space-y-2 p-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => {
                  setLoaded(false)
                  setError(undefined)
                }}>
                  <RefreshCwIcon />
                  Try again
                </Button>
              </div>
            )}
            {!loading && !error && <CommandEmpty>No workspace found.</CommandEmpty>}
            {!error && (
              <CommandGroup heading="Workspaces">
                {users.map((user) => (
                  <CommandItem key={user.id} value={`${user.username} ${user.role}`} onSelect={() => select(user.username)}>
                    <CheckIcon className={cn("size-4", user.id === workspace.id ? "opacity-100" : "opacity-0")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{user.username}</p>
                      <p className="text-xs capitalize text-muted-foreground">{user.role}</p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
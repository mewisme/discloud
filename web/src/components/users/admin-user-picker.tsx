"use client"

import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, RefreshCwIcon, UserRoundIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"
import { type AdminDirectoryUser, listAdminUserDirectory } from "@/lib/users/admin-user-directory"
import { cn } from "@/lib/utils"

export function AdminUserPicker({
  value,
  onValueChange,
  allLabel = "All users",
}: {
  value: string
  onValueChange: (userId: string) => void
  allLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const controllerRef = useRef<AbortController>(null)
  const selected = users.find((user) => user.id === value)

  const load = useCallback(async (force = false) => {
    if (loading || loaded && !force) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError(undefined)

    try {
      setUsers(await listAdminUserDirectory(controller.signal))
      setLoaded(true)
    } catch (cause) {
      if (controller.signal.aborted) return

      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }

      setError(apiErrorMessage(cause, "Could not load users"))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setLoading(false)
      }
    }
  }, [loaded, loading, router])

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (value && !loaded && !loading) void load()
  }, [load, loaded, loading, value])

  function changeOpen(next: boolean) {
    setOpen(next)
    if (next && !loaded) void load()
  }

  function select(userId: string) {
    onValueChange(userId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Filter search by user"
          className="w-48 justify-between font-normal"
        >
          <span className="min-w-0 truncate">
            {value ? selected?.username ?? `User ${value.slice(0, 8)}…` : allLabel}
          </span>
          <ChevronsUpDownIcon className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search users…" />

          <CommandList>
            {loading && users.length === 0 && (
              <CommandItem disabled>
                <Loader2Icon className="animate-spin" />
                Loading users…
              </CommandItem>
            )}

            {error && (
              <div className="space-y-2 p-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => void load(true)}>
                  <RefreshCwIcon />
                  Try again
                </Button>
              </div>
            )}

            {!loading && !error && <CommandEmpty>No users found.</CommandEmpty>}

            {!error && (
              <CommandGroup heading="Users">
                <CommandItem value="All users" onSelect={() => select("")}>
                  <CheckIcon className={cn("size-4", value ? "opacity-0" : "opacity-100")} />
                  <UserRoundIcon />
                  <span>{allLabel}</span>
                </CommandItem>

                {users.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={`${user.username} ${user.role} ${user.status} ${user.id}`}
                    onSelect={() => select(user.id)}
                  >
                    <CheckIcon className={cn("size-4", value === user.id ? "opacity-100" : "opacity-0")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{user.username}</p>
                      <p className="truncate text-xs capitalize text-muted-foreground">
                        {user.role} · {user.status}
                      </p>
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
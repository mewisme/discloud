"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, ChevronsUpDownIcon, Clock3Icon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { useUserConfig } from "@/components/settings/user-config-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { apiJSON } from "@/lib/api/client"
import type { UpdateCommonConfigInput, UserConfig } from "@/lib/api/models"
import { apiErrorMessage, formatDateTime } from "@/lib/helpers"
import { cn } from "@/lib/utils"

export function CommonSettings() {
  const router = useRouter()
  const { config, setConfig } = useUserConfig()
  const [timezone, setTimezone] = useState(config.common.timezone || "UTC")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [now, setNow] = useState<Date>()
  const timezones = useMemo(() => availableTimezones(), [])
  const dirty = timezone !== config.common.timezone

  useEffect(() => {
    setTimezone(config.common.timezone || "UTC")
  }, [config.common.timezone])

  useEffect(() => {
    setNow(new Date())
  }, [])

  async function save() {
    setPending(true)

    try {
      const input = { timezone } satisfies UpdateCommonConfigInput
      const next = await apiJSON<UserConfig>("/me/config/common", {
        method: "PUT",
        body: input,
      })

      setConfig(next)
      toast.success("Common settings updated")
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update common settings."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3Icon className="size-4" />
          Time zone
        </CardTitle>
        <CardDescription>
          Used only when displaying dates and times. DisCloud continues storing and processing timestamps in UTC.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium">Display time zone</label>

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
                <span className="truncate">{timezone}</span>
                <ChevronsUpDownIcon className="shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
              <Command>
                <CommandInput placeholder="Search time zones…" />
                <CommandList>
                  <CommandEmpty>No time zone found.</CommandEmpty>

                  {timezones.map((item) => (
                    <CommandItem
                      key={item}
                      value={item}
                      onSelect={() => {
                        setTimezone(item)
                        setOpen(false)
                      }}
                    >
                      <span className="truncate">{item}</span>
                      <CheckIcon className={cn("ml-auto", item === timezone ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          <p className="mt-1 font-medium">
            {now ? formatDateTime(now, timezone) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{timezone}</p>
        </div>

        <div className="flex justify-end">
          <Button disabled={!dirty || pending} onClick={() => void save()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function availableTimezones() {
  const supported = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : []

  return [...new Set(["UTC", ...supported])].sort((left, right) => {
    if (left === "UTC") return -1
    if (right === "UTC") return 1
    return left.localeCompare(right)
  })
}
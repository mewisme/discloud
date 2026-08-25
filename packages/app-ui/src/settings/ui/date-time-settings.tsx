"use client"

import { formatDateTime } from "@discloud/shared/format"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@discloud/ui/components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@discloud/ui/components/popover"
import { ChevronsUpDownIcon, Clock3Icon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { SettingsRow } from "./settings-row"

export function DateTimeSettings({ timezone, onTimezoneChange }: { timezone: string; onTimezoneChange: (timezone: string) => void }) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState<Date>()
  const timezones = useMemo(() => availableTimezones(), [])

  useEffect(() => setNow(new Date()), [])

  return (
    <Card id="date-time" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Clock3Icon className="size-4" />Date and time</CardTitle>
        <CardDescription>Configure how dates and times are displayed. DisCloud continues storing and processing timestamps in UTC.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow title="Display time zone" description="Used throughout the interface when formatting timestamps." last>
          <div className="space-y-3">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button id="display-timezone" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal"><span className="truncate">{timezone}</span><ChevronsUpDownIcon className="shrink-0 text-muted-foreground" /></Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
                <Command>
                  <CommandInput placeholder="Search time zones…" />
                  <CommandList>
                    <CommandEmpty>No time zone found.</CommandEmpty>
                    {timezones.map((item) => <CommandItem key={item} value={item} data-checked={timezone === item} onSelect={() => { onTimezoneChange(item); setOpen(false) }}><span className="truncate">{item}</span></CommandItem>)}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Preview</p>
              <p className="mt-1 font-medium">{now ? formatDateTime(now, timezone) : "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{timezone}</p>
            </div>
          </div>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}

function availableTimezones() {
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
  return [...new Set(["UTC", ...supported])].sort((left, right) => left === "UTC" ? -1 : right === "UTC" ? 1 : left.localeCompare(right))
}

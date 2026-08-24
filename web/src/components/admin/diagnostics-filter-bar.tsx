"use client"

import { FilterToolbar, type FilterToolbarFilter } from "@discloud/app-ui/shared/filter-toolbar"
import { Button } from "@discloud/ui/components/button"
import { Calendar } from "@discloud/ui/components/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@discloud/ui/components/popover"
import { cn } from "@discloud/ui/lib/utils"
import { CalendarRangeIcon, RefreshCwIcon, XIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { DateRange } from "react-day-picker"

export type DiagnosticsDateRange = DateRange

export function DiagnosticsFilterBar({ children, className, filters, loading, onApply, onReset }: { children: ReactNode; className?: string; filters: readonly FilterToolbarFilter[]; loading: boolean; onApply: () => void; onReset: () => void }) {
  return (
    <FilterToolbar
      filters={filters}
      onClear={onReset}
      contentClassName={cn("sm:grid-cols-2", className)}
      footer={(close) => <><Button size="sm" variant="ghost" disabled={loading} onClick={onReset}><XIcon />Reset</Button><Button size="sm" variant="outline" disabled={loading} onClick={() => { onApply(); close() }}><RefreshCwIcon className={loading ? "animate-spin" : undefined} />Apply</Button></>}
    >
      {children}
    </FilterToolbar>
  )
}

export function DiagnosticsDateRangePicker({ value, onChange }: { value?: DiagnosticsDateRange; onChange: (value?: DiagnosticsDateRange) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="w-full justify-start font-normal"><CalendarRangeIcon /><span className="truncate">{dateRangeLabel(value)}</span></Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="range" selected={value} defaultMonth={value?.from} onSelect={onChange} />
        {value?.from ? <div className="flex justify-end border-t p-2"><Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>Clear dates</Button></div> : null}
      </PopoverContent>
    </Popover>
  )
}

function dateRangeLabel(value?: DiagnosticsDateRange) {
  if (!value?.from) return "Any date"
  const from = formatDate(value.from)
  if (!value.to || isSameDay(value.from, value.to)) return from
  return `${from} – ${formatDate(value.to)}`
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date)
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

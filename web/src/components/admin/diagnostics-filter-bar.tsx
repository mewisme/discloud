"use client"

import { CalendarRangeIcon, RefreshCwIcon, XIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type DiagnosticsDateRange = DateRange

export function DiagnosticsFilterBar({
  children,
  className,
  loading,
  onApply,
  onReset,
}: {
  children: ReactNode
  className?: string
  loading: boolean
  onApply: () => void
  onReset: () => void
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
        <div className={cn("grid min-w-0 flex-1 gap-2", className)}>
          {children}
        </div>

        <div className="flex shrink-0 justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={loading} onClick={onReset}>
            <XIcon />
            Reset
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={onApply}>
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DiagnosticsDateRangePicker({
  value,
  onChange,
}: {
  value?: DiagnosticsDateRange
  onChange: (value?: DiagnosticsDateRange) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="w-full justify-start font-normal">
          <CalendarRangeIcon />
          <span className="truncate">{dateRangeLabel(value)}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={value}
          defaultMonth={value?.from}
          onSelect={onChange}
        />

        {value?.from && (
          <div className="flex justify-end border-t p-2">
            <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
              Clear dates
            </Button>
          </div>
        )}
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
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}
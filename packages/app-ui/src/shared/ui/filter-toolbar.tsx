"use client"

import { Button } from "@discloud/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@discloud/ui/components/popover"
import { cn } from "@discloud/ui/lib/utils"
import { SlidersHorizontalIcon, XIcon } from "lucide-react"
import { type ReactNode, useState } from "react"

export type FilterToolbarFilter = { key: string; label: string; onRemove: () => void }

export function FilterToolbar({ filters, children, leading, actions, trailing, contentClassName, clearVisible = filters.length > 0, clearLabel = "Clear all", onClear, footer }: { filters: readonly FilterToolbarFilter[]; children: ReactNode; leading?: ReactNode; actions?: ReactNode; trailing?: ReactNode; contentClassName?: string; clearVisible?: boolean; clearLabel?: string; onClear?: () => void; footer?: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {leading}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant={filters.length ? "secondary" : "outline"} aria-label="Open filters">
              <SlidersHorizontalIcon />
              Filters{filters.length ? ` (${filters.length})` : ""}
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-[calc(100vw-2rem)] max-w-2xl p-0">
            <div className={cn("grid gap-4 p-4", contentClassName)}>{children}</div>
            {footer ? <div className="flex justify-end gap-2 border-t p-3">{footer(() => setOpen(false))}</div> : null}
          </PopoverContent>
        </Popover>

        {actions}
        {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
        {clearVisible && onClear ? <Button size="sm" variant="ghost" onClick={onClear}><XIcon />{clearLabel}</Button> : null}
      </div>

      {filters.length ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {filters.map((filter) => (
            <Button key={filter.key} size="xs" variant="secondary" className="h-7 max-w-full rounded-full px-2.5 font-normal" aria-label={`Remove filter ${filter.label}`} onClick={filter.onRemove}>
              <span className="max-w-64 truncate">{filter.label}</span>
              <XIcon className="size-3" />
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

"use client"

import { ArrowDownIcon, ArrowUpIcon, LayoutGridIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { BrowserOptions, BrowserSort } from "@/lib/files/browser"

type ControlsProps = {
  options: BrowserOptions
  onChange: (patch: Partial<BrowserOptions>) => void
  onSortChange: (sort: BrowserSort) => void
}

export function DesktopBrowserControls({ options, onChange, onSortChange }: ControlsProps) {
  return (
    <>
      <Select value={options.sort} onValueChange={(value) => onSortChange(value as BrowserSort)}>
        <SelectTrigger className="w-30">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Sort by</SelectLabel>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="updated">Modified</SelectItem>
            <SelectItem value="size">Size</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      <Button
        size="icon"
        variant="outline"
        aria-label={options.order === "asc" ? "Sort descending" : "Sort ascending"}
        onClick={() => onChange({ order: options.order === "asc" ? "desc" : "asc" })}
      >
        {options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </Button>

      <div className="flex rounded-lg border p-0.5">
        <Button
          variant={options.view === "list" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="List view"
          aria-pressed={options.view === "list"}
          onClick={() => onChange({ view: "list" })}
        >
          <ListIcon />
        </Button>

        <Button
          variant={options.view === "grid" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Grid view"
          aria-pressed={options.view === "grid"}
          onClick={() => onChange({ view: "grid" })}
        >
          <LayoutGridIcon />
        </Button>
      </div>
    </>
  )
}

export function DockBrowserControls({ options, onChange, onSortChange }: ControlsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" aria-label="View and sort options" title="View and sort options">
          <SlidersHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="left" align="center" className="w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SlidersHorizontalIcon />
            Sort
          </DropdownMenuSubTrigger>

          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={options.sort} onValueChange={(value) => onSortChange(value as BrowserSort)}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated">Modified</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem onSelect={() => onChange({ order: options.order === "asc" ? "desc" : "asc" })}>
          {options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
          {options.order === "asc" ? "Ascending" : "Descending"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup value={options.view} onValueChange={(value) => onChange({ view: value as BrowserOptions["view"] })}>
          <DropdownMenuRadioItem value="list">
            <ListIcon />
            List
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="grid">
            <LayoutGridIcon />
            Grid
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
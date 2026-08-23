"use client"

import { searchQuickFilterPatch, type SearchCategory, type SearchFlag, type SearchKind, type SearchOptions, type SearchSort, type SearchState } from "@discloud/shared/search"
import { Button } from "@discloud/ui/components/button"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Clock3Icon, HardDriveIcon, ImageIcon, SlidersHorizontalIcon, VideoIcon, XIcon } from "lucide-react"
import { type InputHTMLAttributes, type ReactNode, useEffect, useState } from "react"

const MIB = 1024 * 1024

export function SearchFilters({ options, admin = false, leading, onChange, onSortChange, onReset }: { options: SearchOptions; admin?: boolean; leading?: ReactNode; onChange: (patch: Partial<SearchOptions>) => void; onSortChange: (sort: SearchSort) => void; onReset: () => void }) {
  const advancedCount = advancedFilterCount(options, admin)
  const filtered = hasFilters(options, admin)
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedCount > 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {leading}

        <Select value={options.kind} onValueChange={(value) => onChange({ kind: value as SearchKind })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Type</SelectLabel>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="file">Files</SelectItem>
              <SelectItem value="folder">Folders</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.category} onValueChange={(value) => onChange({ category: value as SearchCategory })}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Category</SelectLabel>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="image">Images</SelectItem>
              <SelectItem value="video">Videos</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
              <SelectItem value="document">Documents</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="archive">Archives</SelectItem>
              <SelectItem value="application">Applications</SelectItem>
              <SelectItem value="binary">Binary</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.favorite} onValueChange={(value) => onChange({ favorite: value as SearchFlag })}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by favorite status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Favorite status</SelectLabel>
              <SelectItem value="any">Any favorite</SelectItem>
              <SelectItem value="true">Favorites</SelectItem>
              <SelectItem value="false">Not favorite</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.shared} onValueChange={(value) => onChange({ shared: value as SearchFlag })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by sharing status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Sharing</SelectLabel>
              <SelectItem value="any">Any sharing</SelectItem>
              <SelectItem value="true">Shared</SelectItem>
              <SelectItem value="false">Not shared</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.sort} onValueChange={(value) => onSortChange(value as SearchSort)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Sort search results by"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Sort by</SelectLabel>
              {options.q && <SelectItem value="relevance">Relevance</SelectItem>}
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="updated">Modified</SelectItem>
              <SelectItem value="size">Size</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={options.order} onValueChange={(value) => onChange({ order: value as SearchOptions["order"] })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Sort direction"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Direction</SelectLabel>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Button size="sm" variant={advancedCount ? "secondary" : "outline"} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>
          <SlidersHorizontalIcon />
          Advanced{advancedCount ? ` (${advancedCount})` : ""}
        </Button>

        {(options.q || filtered) && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            <XIcon />
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Quick filters</span>
        <Button size="xs" variant="outline" onClick={() => onChange(searchQuickFilterPatch("large"))}><HardDriveIcon />Large files</Button>
        <Button size="xs" variant="outline" onClick={() => onChange(searchQuickFilterPatch("images"))}><ImageIcon />Images</Button>
        <Button size="xs" variant="outline" onClick={() => onChange(searchQuickFilterPatch("videos"))}><VideoIcon />Videos</Button>
        <Button size="xs" variant="outline" onClick={() => onChange(searchQuickFilterPatch("recent"))}><Clock3Icon />Modified recently</Button>
      </div>

      {advancedOpen && (
        <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-4">
          <FilterField label="MIME type">
            <CommitInput value={options.mimeType} placeholder="image/png" aria-label="Filter by MIME type" onCommit={(mimeType) => onChange({ mimeType })} />
          </FilterField>

          <FilterField label="Minimum size (MiB)">
            <CommitInput type="number" min="0" step="0.01" inputMode="decimal" value={sizeMiB(options.minSize)} placeholder="0" aria-label="Minimum file size in MiB" onCommit={(value) => onChange({ minSize: sizeBytes(value) })} />
          </FilterField>

          <FilterField label="Maximum size (MiB)">
            <CommitInput type="number" min="0" step="0.01" inputMode="decimal" value={sizeMiB(options.maxSize)} placeholder="Any" aria-label="Maximum file size in MiB" onCommit={(value) => onChange({ maxSize: sizeBytes(value) })} />
          </FilterField>

          {admin && (
            <FilterField label="State">
              <Select value={options.state} onValueChange={(value) => onChange({ state: value as SearchState })}>
                <SelectTrigger aria-label="Filter by resource state"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="trash">Trash</SelectItem>
                  <SelectItem value="all">Active and trash</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          )}

          <FilterField label="Created from">
            <Input type="datetime-local" value={dateTimeLocal(options.createdFrom)} aria-label="Created from" onChange={(event) => onChange({ createdFrom: dateTimeISO(event.target.value) })} />
          </FilterField>

          <FilterField label="Created to">
            <Input type="datetime-local" value={dateTimeLocal(options.createdTo)} aria-label="Created to" onChange={(event) => onChange({ createdTo: dateTimeISO(event.target.value) })} />
          </FilterField>

          <FilterField label="Modified from">
            <Input type="datetime-local" value={dateTimeLocal(options.updatedFrom)} aria-label="Modified from" onChange={(event) => onChange({ updatedFrom: dateTimeISO(event.target.value) })} />
          </FilterField>

          <FilterField label="Modified to">
            <Input type="datetime-local" value={dateTimeLocal(options.updatedTo)} aria-label="Modified to" onChange={(event) => onChange({ updatedTo: dateTimeISO(event.target.value) })} />
          </FilterField>
        </div>
      )}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  )
}

function CommitInput({ value, onCommit, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onBlur" | "onChange"> & { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  function commit() {
    const next = draft.trim()
    if (next !== value) onCommit(next)
  }

  return <Input {...props} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} />
}

function advancedFilterCount(options: SearchOptions, admin: boolean) {
  return Number(!!options.mimeType)
    + Number(options.minSize !== undefined)
    + Number(options.maxSize !== undefined)
    + Number(!!options.createdFrom)
    + Number(!!options.createdTo)
    + Number(!!options.updatedFrom)
    + Number(!!options.updatedTo)
    + Number(admin && options.state !== "active")
}

function hasFilters(options: SearchOptions, admin: boolean) {
  return options.kind !== "all"
    || options.category !== "all"
    || options.favorite !== "any"
    || options.shared !== "any"
    || options.state !== "active"
    || advancedFilterCount(options, admin) > 0
}

function sizeMiB(bytes?: number) {
  if (bytes === undefined) return ""
  return String(Number((bytes / MIB).toFixed(2)))
}

function sizeBytes(value: string) {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  const bytes = Math.round(parsed * MIB)
  return Number.isSafeInteger(bytes) ? bytes : undefined
}

function dateTimeLocal(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function dateTimeISO(value: string) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}

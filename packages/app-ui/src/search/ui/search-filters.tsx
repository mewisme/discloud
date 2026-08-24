"use client"

import { SEARCH_LARGE_FILE_MIN_BYTES, SEARCH_RECENT_WINDOW_MS, searchQuickFilterPatch, type SearchCategory, type SearchFlag, type SearchKind, type SearchOptions, type SearchOrder, type SearchQuickFilter, type SearchSort, type SearchState } from "@discloud/shared/search"
import { Button } from "@discloud/ui/components/button"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Clock3Icon, HardDriveIcon, ImageIcon, VideoIcon } from "lucide-react"
import { type InputHTMLAttributes, type ReactNode, useEffect, useState } from "react"
import { FilterToolbar, type FilterToolbarFilter } from "../../shared/ui/filter-toolbar"

const MIB = 1024 * 1024

export function SearchFilters({ options, admin = false, leading, onChange, onReset }: { options: SearchOptions; admin?: boolean; leading?: ReactNode; onChange: (patch: Partial<SearchOptions>) => void; onSortChange: (sort: SearchSort) => void; onReset: () => void }) {
  const filters = activeFilters(options, admin, onChange)

  return (
    <FilterToolbar
      filters={filters}
      leading={leading}
      actions={<QuickFilters options={options} onChange={onChange} />}
      trailing={<SortControl options={options} onChange={onChange} />}
      clearVisible={!!options.q || filters.length > 0}
      onClear={onReset}
      contentClassName="md:grid-cols-2"
    >
      <FilterField label="Type">
        <Select value={options.kind} onValueChange={(value) => onChange({ kind: value as SearchKind })}>
          <SelectTrigger aria-label="Filter by type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Type</SelectLabel>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="file">Files</SelectItem>
              <SelectItem value="folder">Folders</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Category">
        <Select value={options.category} onValueChange={(value) => onChange({ category: value as SearchCategory })}>
          <SelectTrigger aria-label="Filter by category"><SelectValue /></SelectTrigger>
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
      </FilterField>

      <FilterField label="Favorite status">
        <Select value={options.favorite} onValueChange={(value) => onChange({ favorite: value as SearchFlag })}>
          <SelectTrigger aria-label="Filter by favorite status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any favorite</SelectItem>
            <SelectItem value="true">Favorites</SelectItem>
            <SelectItem value="false">Not favorite</SelectItem>
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Sharing">
        <Select value={options.shared} onValueChange={(value) => onChange({ shared: value as SearchFlag })}>
          <SelectTrigger aria-label="Filter by sharing status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any sharing</SelectItem>
            <SelectItem value="true">Shared</SelectItem>
            <SelectItem value="false">Not shared</SelectItem>
          </SelectContent>
        </Select>
      </FilterField>

      {admin ? (
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
      ) : null}

      <FilterField label="MIME type">
        <CommitInput value={options.mimeType} placeholder="image/png" aria-label="Filter by MIME type" onCommit={(mimeType) => onChange({ mimeType })} />
      </FilterField>

      <FilterField label="Minimum size (MiB)">
        <CommitInput type="number" min="0" step="0.01" inputMode="decimal" value={sizeMiB(options.minSize)} placeholder="0" aria-label="Minimum file size in MiB" onCommit={(value) => onChange({ minSize: sizeBytes(value) })} />
      </FilterField>

      <FilterField label="Maximum size (MiB)">
        <CommitInput type="number" min="0" step="0.01" inputMode="decimal" value={sizeMiB(options.maxSize)} placeholder="Any" aria-label="Maximum file size in MiB" onCommit={(value) => onChange({ maxSize: sizeBytes(value) })} />
      </FilterField>

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
    </FilterToolbar>
  )
}

function QuickFilters({ options, onChange }: { options: SearchOptions; onChange: (patch: Partial<SearchOptions>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="xs" variant={quickFilterActive(options, "large") ? "secondary" : "outline"} onClick={() => onChange(searchQuickFilterPatch("large"))}><HardDriveIcon />Large</Button>
      <Button size="xs" variant={quickFilterActive(options, "images") ? "secondary" : "outline"} onClick={() => onChange(searchQuickFilterPatch("images"))}><ImageIcon />Images</Button>
      <Button size="xs" variant={quickFilterActive(options, "videos") ? "secondary" : "outline"} onClick={() => onChange(searchQuickFilterPatch("videos"))}><VideoIcon />Videos</Button>
      <Button size="xs" variant={quickFilterActive(options, "recent") ? "secondary" : "outline"} onClick={() => onChange(searchQuickFilterPatch("recent"))}><Clock3Icon />Recent</Button>
    </div>
  )
}

function SortControl({ options, onChange }: { options: SearchOptions; onChange: (patch: Partial<SearchOptions>) => void }) {
  return (
    <Select value={`${options.sort}:${options.order}`} onValueChange={(value) => {
      const [sort, order] = value.split(":") as [SearchSort, SearchOrder]
      onChange({ sort, order })
    }}>
      <SelectTrigger size="sm" className="w-44" aria-label="Sort search results"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Sort</SelectLabel>
          {options.q ? <><SelectItem value="relevance:desc">Relevance · best first</SelectItem><SelectItem value="relevance:asc">Relevance · lowest first</SelectItem></> : null}
          <SelectItem value="name:asc">Name · A–Z</SelectItem>
          <SelectItem value="name:desc">Name · Z–A</SelectItem>
          <SelectItem value="created:desc">Created · newest</SelectItem>
          <SelectItem value="created:asc">Created · oldest</SelectItem>
          <SelectItem value="updated:desc">Modified · newest</SelectItem>
          <SelectItem value="updated:asc">Modified · oldest</SelectItem>
          <SelectItem value="size:desc">Size · largest</SelectItem>
          <SelectItem value="size:asc">Size · smallest</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function activeFilters(options: SearchOptions, admin: boolean, onChange: (patch: Partial<SearchOptions>) => void): FilterToolbarFilter[] {
  const filters: FilterToolbarFilter[] = []
  if (options.kind !== "all") filters.push({ key: "kind", label: options.kind === "file" ? "Files" : "Folders", onRemove: () => onChange({ kind: "all" }) })
  if (options.category !== "all") filters.push({ key: "category", label: categoryLabel(options.category), onRemove: () => onChange({ category: "all" }) })
  if (options.favorite !== "any") filters.push({ key: "favorite", label: options.favorite === "true" ? "Favorites" : "Not favorite", onRemove: () => onChange({ favorite: "any" }) })
  if (options.shared !== "any") filters.push({ key: "shared", label: options.shared === "true" ? "Shared" : "Not shared", onRemove: () => onChange({ shared: "any" }) })
  if (admin && options.state !== "active") filters.push({ key: "state", label: options.state === "trash" ? "Trash" : "Active + trash", onRemove: () => onChange({ state: "active" }) })
  if (options.mimeType) filters.push({ key: "mime", label: `MIME: ${options.mimeType}`, onRemove: () => onChange({ mimeType: "" }) })
  if (options.minSize !== undefined || options.maxSize !== undefined) filters.push({ key: "size", label: sizeFilterLabel(options.minSize, options.maxSize), onRemove: () => onChange({ minSize: undefined, maxSize: undefined }) })
  if (options.createdFrom || options.createdTo) filters.push({ key: "created", label: rangeFilterLabel("Created", options.createdFrom, options.createdTo), onRemove: () => onChange({ createdFrom: "", createdTo: "" }) })
  if (options.updatedFrom || options.updatedTo) filters.push({ key: "updated", label: rangeFilterLabel("Modified", options.updatedFrom, options.updatedTo), onRemove: () => onChange({ updatedFrom: "", updatedTo: "" }) })
  return filters
}

function quickFilterActive(options: SearchOptions, filter: SearchQuickFilter) {
  if (filter === "large") return options.kind === "file" && options.minSize === SEARCH_LARGE_FILE_MIN_BYTES && options.sort === "size" && options.order === "desc"
  if (filter === "images") return options.kind === "file" && options.category === "image"
  if (filter === "videos") return options.kind === "file" && options.category === "video"
  const updatedFrom = Date.parse(options.updatedFrom)
  return !!options.updatedFrom && !options.updatedTo && options.sort === "updated" && options.order === "desc" && Number.isFinite(updatedFrom) && Math.abs(Date.now() - updatedFrom - SEARCH_RECENT_WINDOW_MS) < 5 * 60 * 1000
}

function categoryLabel(category: SearchCategory) {
  const labels: Record<SearchCategory, string> = { all: "All categories", image: "Images", video: "Videos", audio: "Audio", document: "Documents", text: "Text", archive: "Archives", application: "Applications", binary: "Binary", other: "Other" }
  return labels[category]
}

function sizeFilterLabel(min?: number, max?: number) {
  if (min !== undefined && max !== undefined) return `Size: ${sizeMiB(min)}–${sizeMiB(max)} MiB`
  if (min !== undefined) return `Size: ≥ ${sizeMiB(min)} MiB`
  return `Size: ≤ ${sizeMiB(max)} MiB`
}

function rangeFilterLabel(label: string, from: string, to: string) {
  if (from && to) return `${label}: ${filterDate(from)} – ${filterDate(to)}`
  if (from) return `${label}: from ${filterDate(from)}`
  return `${label}: until ${filterDate(to)}`
}

function filterDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date)
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-1.5 text-xs font-medium text-muted-foreground"><span>{label}</span>{children}</div>
}

function CommitInput({ value, onCommit, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onBlur" | "onChange"> & { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  function commit() { const next = draft.trim(); if (next !== value) onCommit(next) }
  return <Input {...props} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} />
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

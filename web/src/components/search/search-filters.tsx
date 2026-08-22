"use client"

import type { SearchCategory, SearchFlag, SearchKind, SearchOptions, SearchSort } from "@discloud/shared/search"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminUserPicker } from "@/components/users/admin-user-picker"

export function SearchFilters({
  options,
  admin,
  workspaceId,
  workspaceUsername,
  onWorkspaceChange,
  onChange,
  onSortChange,
  onReset,
}: {
  options: SearchOptions
  admin: boolean
  workspaceId: string
  workspaceUsername: string
  onWorkspaceChange: (workspace: { username: string }) => void
  onChange: (patch: Partial<SearchOptions>) => void
  onSortChange: (sort: SearchSort) => void
  onReset: () => void
}) {
  const filtered = options.kind !== "all"
    || options.category !== "all"
    || options.favorite !== "any"
    || options.shared !== "any"

  return (
    <div className="flex flex-wrap items-center gap-2">
      {admin && (
        <AdminUserPicker
          value={workspaceId}
          valueLabel={workspaceUsername}
          ariaLabel="Filter search by user"
          onValueChange={onWorkspaceChange}
        />
      )}

      <Select value={options.kind} onValueChange={(value) => onChange({ kind: value as SearchKind })}>
        <SelectTrigger size="sm" className="w-32" aria-label="Filter by type">
          <SelectValue />
        </SelectTrigger>
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
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by category">
          <SelectValue />
        </SelectTrigger>
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
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by favorite status">
          <SelectValue />
        </SelectTrigger>
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
        <SelectTrigger size="sm" className="w-32" aria-label="Filter by sharing status">
          <SelectValue />
        </SelectTrigger>
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
        <SelectTrigger size="sm" className="w-36" aria-label="Sort search results by">
          <SelectValue />
        </SelectTrigger>
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

      <Select value={options.order} onValueChange={(value) => onChange({ order: value as "asc" | "desc" })}>
        <SelectTrigger size="sm" className="w-32" aria-label="Sort direction">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Direction</SelectLabel>
            <SelectItem value="asc">Ascending</SelectItem>
            <SelectItem value="desc">Descending</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      {(options.q || filtered) && (
        <Button size="sm" variant="ghost" onClick={onReset}>
          <XIcon />
          Clear
        </Button>
      )}
    </div>
  )
}
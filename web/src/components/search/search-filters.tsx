"use client"

import { SearchFilters as AppSearchFilters } from "@discloud/app-ui/search/search-filters"
import type { SearchOptions, SearchSort } from "@discloud/shared/search"

import { AdminUserPicker } from "@/components/users/admin-user-picker"

export function SearchFilters({ options, admin, workspaceId, workspaceUsername, onWorkspaceChange, onChange, onSortChange, onReset }: { options: SearchOptions; admin: boolean; workspaceId: string; workspaceUsername: string; onWorkspaceChange: (workspace: { username: string }) => void; onChange: (patch: Partial<SearchOptions>) => void; onSortChange: (sort: SearchSort) => void; onReset: () => void }) {
  return (
    <AppSearchFilters
      options={options}
      admin={admin}
      leading={admin ? <AdminUserPicker value={workspaceId} valueLabel={workspaceUsername} ariaLabel="Filter search by user" onValueChange={onWorkspaceChange} /> : undefined}
      onChange={onChange}
      onSortChange={onSortChange}
      onReset={onReset}
    />
  )
}

"use client"

import { defaultSearchOrder, parseSearchOptions, patchSearchOptions, type SearchOptions, type SearchSort, searchURL } from "@discloud/shared/search"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo } from "react"

import { useCurrentUser } from "@/components/app/current-user-context"
import { useWorkspace } from "@/components/app/workspace-context"
import { SearchFilters } from "@/components/search/search-filters"
import { SearchInput } from "@/components/search/search-input"
import { SearchResults } from "@/components/search/search-results"

export function SearchView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useCurrentUser()
  const workspace = useWorkspace()
  const queryKey = searchParams.toString()
  const options = useMemo(
    () => parseSearchOptions(new URLSearchParams(queryKey)),
    [queryKey],
  )

  const replaceOptions = useCallback((patch: Partial<SearchOptions>) => {
    router.replace(
      searchURL(
        workspace.username,
        patchSearchOptions(options, patch),
      ),
      { scroll: false },
    )
  }, [options, router, workspace.username])

  function changeSort(sort: SearchSort) {
    replaceOptions({
      sort,
      order: defaultSearchOrder(sort),
    })
  }

  function changeWorkspace(next: { username: string }) {
    router.push(
      searchURL(next.username, options),
      { scroll: false },
    )
  }

  function reset() {
    router.replace(
      searchURL(
        workspace.username,
        parseSearchOptions(new URLSearchParams()),
      ),
      { scroll: false },
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search files and folders in @{workspace.username}&apos;s workspace.
        </p>
      </div>

      <SearchInput
        key={`search-input:${options.q}`}
        initialValue={options.q}
        onChange={(q) => replaceOptions({ q })}
      />

      <SearchFilters
        options={options}
        admin={user.role === "admin"}
        workspaceId={workspace.id}
        workspaceUsername={workspace.username}
        onWorkspaceChange={changeWorkspace}
        onChange={replaceOptions}
        onSortChange={changeSort}
        onReset={reset}
      />

      <SearchResults
        key={`search-results:${workspace.id}:${queryKey}`}
        options={options}
      />
    </div>
  )
}
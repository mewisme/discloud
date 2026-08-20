"use client"

import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, Globe2Icon, LayoutGridIcon, ListIcon, MoreHorizontalIcon, RefreshCwIcon, Share2Icon, SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Node } from "@/lib/api/models"
import type { BrowserOptions, BrowserSort } from "@/lib/files/browser"

export function FolderActionsMenu({
  folder,
  options,
  canShare,
  mobile = false,
  reloading = false,
  onReload,
  onAccess,
  onPublicShare,
  onOptionsChange,
}: {
  folder: Node
  options: BrowserOptions
  canShare: boolean
  mobile?: boolean
  reloading?: boolean
  onReload?: () => Promise<void>
  onAccess: () => void
  onPublicShare: () => void
  onOptionsChange?: (patch: Partial<BrowserOptions>) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" aria-label="Folder actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {mobile && onReload && (
          <DropdownMenuItem disabled={reloading} onSelect={() => void onReload()}>
            <RefreshCwIcon className={reloading ? "animate-spin" : undefined} />
            Reload
          </DropdownMenuItem>
        )}

        <DropdownMenuItem asChild>
          <a href={`/api/backend/api/v1/folders/${encodeURIComponent(folder.id)}/download`}>
            <DownloadIcon />
            Download folder
          </a>
        </DropdownMenuItem>

        {canShare && (
          <>
            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={onAccess}>
              <Share2Icon />
              Manage access
            </DropdownMenuItem>

            <DropdownMenuItem onSelect={onPublicShare}>
              <Globe2Icon />
              Public link
            </DropdownMenuItem>
          </>
        )}

        {mobile && onOptionsChange && (
          <>
            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SlidersHorizontalIcon />
                Sort
              </DropdownMenuSubTrigger>

              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={options.sort}
                  onValueChange={(value) => onOptionsChange({
                    sort: value as BrowserSort,
                    order: value === "name" ? "asc" : "desc",
                  })}
                >
                  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="updated">Modified</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem onSelect={() => onOptionsChange({ order: options.order === "asc" ? "desc" : "asc" })}>
              {options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
              {options.order === "asc" ? "Ascending" : "Descending"}
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {options.view === "list" ? <ListIcon /> : <LayoutGridIcon />}
                View
              </DropdownMenuSubTrigger>

              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={options.view}
                  onValueChange={(value) => onOptionsChange({ view: value as BrowserOptions["view"] })}
                >
                  <DropdownMenuRadioItem value="list">
                    <ListIcon />
                    List
                  </DropdownMenuRadioItem>

                  <DropdownMenuRadioItem value="grid">
                    <LayoutGridIcon />
                    Grid
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
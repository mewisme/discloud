"use client"

import { Loader2Icon, MoreHorizontalIcon, MoveIcon, StarIcon, StarOffIcon, Trash2Icon, XIcon } from "lucide-react"

import { BottomDock } from "@/components/app/bottom-dock-stack"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { BrowserNode } from "@/lib/api/models"

export function FileBrowserSelectionToolbar({
  selectedNodes,
  favoritePending,
  mergeHorizontalDocks,
  canMove,
  canTrash,
  canFavorite,
  canUnfavorite,
  onMove,
  onTrash,
  onFavorite,
  onUnfavorite,
  onClear,
}: {
  selectedNodes: readonly BrowserNode[]
  favoritePending: boolean
  mergeHorizontalDocks: boolean
  canMove: boolean
  canTrash: boolean
  canFavorite: boolean
  canUnfavorite: boolean
  onMove: () => void
  onTrash: () => void
  onFavorite: () => void
  onUnfavorite: () => void
  onClear: () => void
}) {
  const hasActions = canMove || canTrash || canFavorite || canUnfavorite

  if (!selectedNodes.length) return null

  return (
    <BottomDock slot="selection">
      <div
        role="toolbar"
        aria-label={`${selectedNodes.length} selected item${selectedNodes.length === 1 ? "" : "s"} actions`}
        data-file-browser-docked={mergeHorizontalDocks || undefined}
        className="flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150"
      >
        <span className="whitespace-nowrap px-2 text-sm font-medium">
          {selectedNodes.length} selected
        </span>

        <div className="hidden h-5 w-px bg-border sm:block" />

        <div className="hidden items-center gap-1 sm:flex">
          {canMove && (
            <Button
              size="sm"
              variant="ghost"
              disabled={favoritePending}
              onClick={onMove}
            >
              <MoveIcon />
              Move
            </Button>
          )}

          {canFavorite && (
            <Button
              size="sm"
              variant="ghost"
              disabled={favoritePending}
              onClick={onFavorite}
            >
              {favoritePending
                ? <Loader2Icon className="animate-spin" />
                : <StarIcon />}
              Favorite
            </Button>
          )}

          {canUnfavorite && (
            <Button
              size="sm"
              variant="ghost"
              disabled={favoritePending}
              onClick={onUnfavorite}
            >
              {favoritePending
                ? <Loader2Icon className="animate-spin" />
                : <StarOffIcon />}
              Unfavorite
            </Button>
          )}

          {canTrash && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive focus-visible:text-destructive"
              disabled={favoritePending}
              onClick={onTrash}
            >
              <Trash2Icon />
              Trash
            </Button>
          )}
        </div>

        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="sm:hidden"
                disabled={favoritePending}
              >
                <MoreHorizontalIcon />
                Actions
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              {canMove && (
                <DropdownMenuItem onSelect={onMove}>
                  <MoveIcon />
                  Move
                </DropdownMenuItem>
              )}

              {canFavorite && (
                <DropdownMenuItem onSelect={onFavorite}>
                  <StarIcon />
                  Add to favorites
                </DropdownMenuItem>
              )}

              {canUnfavorite && (
                <DropdownMenuItem onSelect={onUnfavorite}>
                  <StarOffIcon />
                  Remove from favorites
                </DropdownMenuItem>
              )}

              {canTrash && (
                <>
                  {(canMove || canFavorite || canUnfavorite) && <DropdownMenuSeparator />}

                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={onTrash}
                  >
                    <Trash2Icon />
                    Move to trash
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="h-5 w-px bg-border" />

        <Button
          size="icon-sm"
          variant="ghost"
          disabled={favoritePending}
          aria-label="Clear selection"
          title="Clear selection"
          onClick={onClear}
        >
          <XIcon />
        </Button>
      </div>
    </BottomDock>
  )
}
import { BottomDock } from "@discloud/app-ui/shell/dock-stack"
import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { Loader2Icon, MoreHorizontalIcon, MoveIcon, StarIcon, StarOffIcon, Trash2Icon, XIcon } from "lucide-react"

export function DesktopFileSelectionToolbar({ count, canMove, canTrash, canFavorite, canUnfavorite, favoritePending, onMove, onTrash, onFavorite, onUnfavorite, onClear }: {
  count: number
  canMove: boolean
  canTrash: boolean
  canFavorite: boolean
  canUnfavorite: boolean
  favoritePending: boolean
  onMove: () => void
  onTrash: () => void
  onFavorite: () => void
  onUnfavorite: () => void
  onClear: () => void
}) {
  const hasActions = canMove || canTrash || canFavorite || canUnfavorite
  if (!count) return null

  return (
    <BottomDock slot="selection">
      <div role="toolbar" aria-label={`${count} selected item${count === 1 ? "" : "s"} actions`} className="flex max-w-full items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
        <span className="whitespace-nowrap px-2 text-sm font-medium">{count} selected</span>
        <div className="hidden h-5 w-px bg-border lg:block" />

        <div className="hidden items-center gap-1 lg:flex">
          {canMove ? <Button size="sm" variant="ghost" disabled={favoritePending} onClick={onMove}><MoveIcon />Move</Button> : null}
          {canFavorite ? <Button size="sm" variant="ghost" disabled={favoritePending} onClick={onFavorite}>{favoritePending ? <Loader2Icon className="animate-spin" /> : <StarIcon />}Favorite</Button> : null}
          {canUnfavorite ? <Button size="sm" variant="ghost" disabled={favoritePending} onClick={onUnfavorite}>{favoritePending ? <Loader2Icon className="animate-spin" /> : <StarOffIcon />}Unfavorite</Button> : null}
          {canTrash ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive focus-visible:text-destructive" disabled={favoritePending} onClick={onTrash}><Trash2Icon />Trash</Button> : null}
        </div>

        {hasActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="lg:hidden" disabled={favoritePending}><MoreHorizontalIcon />Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canMove ? <DropdownMenuItem onSelect={onMove}><MoveIcon />Move</DropdownMenuItem> : null}
              {canFavorite ? <DropdownMenuItem onSelect={onFavorite}><StarIcon />Add to favorites</DropdownMenuItem> : null}
              {canUnfavorite ? <DropdownMenuItem onSelect={onUnfavorite}><StarOffIcon />Remove from favorites</DropdownMenuItem> : null}
              {canTrash ? (
                <>
                  {(canMove || canFavorite || canUnfavorite) ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem variant="destructive" onSelect={onTrash}><Trash2Icon />Move to trash</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <div className="h-5 w-px bg-border" />
        <Button size="icon-sm" variant="ghost" disabled={favoritePending} aria-label="Clear selection" title="Clear selection" onClick={onClear}><XIcon /></Button>
      </div>
    </BottomDock>
  )
}

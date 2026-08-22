import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, MoveIcon, StarIcon, StarOffIcon, Trash2Icon, XIcon } from "lucide-react"

export function DesktopFileSelectionToolbar({
  count,
  canMove,
  canTrash,
  canFavorite,
  canUnfavorite,
  favoritePending,
  onMove,
  onTrash,
  onFavorite,
  onUnfavorite,
  onClear,
}: {
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
  if (!count) return null

  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur">
      <span className="px-2 text-sm font-medium">{count} selected</span>

      <Button size="sm" variant="outline" disabled={!canMove} onClick={onMove}>
        <MoveIcon />
        Move
      </Button>

      <Button size="sm" variant="outline" disabled={!canTrash} onClick={onTrash}>
        <Trash2Icon />
        Trash
      </Button>

      <Button size="sm" variant="outline" disabled={!canFavorite || favoritePending} onClick={onFavorite}>
        {favoritePending ? <Loader2Icon className="animate-spin" /> : <StarIcon />}
        Favorite
      </Button>

      <Button size="sm" variant="outline" disabled={!canUnfavorite || favoritePending} onClick={onUnfavorite}>
        {favoritePending ? <Loader2Icon className="animate-spin" /> : <StarOffIcon />}
        Unfavorite
      </Button>

      <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Clear selection" onClick={onClear}>
        <XIcon />
      </Button>
    </div>
  )
}
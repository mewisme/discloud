import type { UserConfig } from "@/lib/api/models"
import { cn } from "@/lib/utils"

type ToolbarConfig = UserConfig["common"]["fileBrowserToolbar"]
export type ToolbarVariant = ToolbarConfig["variant"]
export type ToolbarDockPosition = ToolbarConfig["dockPosition"]

export function ToolbarPreview({
  variant,
  dockPosition,
}: {
  variant: ToolbarVariant
  dockPosition: ToolbarDockPosition
}) {
  return (
    <div className="relative h-24 overflow-hidden rounded-lg border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="h-2.5 w-16 rounded-full bg-muted-foreground/20" />
        {variant === "inline" && <PreviewToolbar className="flex-row" />}
      </div>

      <div className="mt-3 h-11 rounded-md border border-dashed bg-background/50" />

      {variant === "dock" && dockPosition === "bottom" && (
        <PreviewToolbar className="absolute bottom-2 left-1/2 -translate-x-1/2 flex-row shadow-sm" />
      )}

      {variant === "dock" && dockPosition === "right" && (
        <PreviewToolbar className="absolute right-2 top-1/2 -translate-y-1/2 flex-col shadow-sm" />
      )}
    </div>
  )
}

function PreviewToolbar({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-1 rounded-md border bg-background p-1", className)}>
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
    </div>
  )
}
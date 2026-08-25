import type { UserConfig } from "@discloud/api/models"
import { cn } from "@discloud/ui/lib/utils"

type CommonConfig = UserConfig["common"]
export type ToolbarVariant = CommonConfig["fileBrowserToolbar"]["variant"]
export type ToolbarDockPosition = CommonConfig["fileBrowserToolbar"]["dockPosition"]

export function ToolbarPreview({ variant, dockPosition }: { variant: ToolbarVariant; dockPosition: ToolbarDockPosition }) {
  return (
    <div className="relative h-24 overflow-hidden rounded-lg border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2"><div className="h-2.5 w-16 rounded-full bg-muted-foreground/20" />{variant === "inline" ? <PreviewToolbar className="flex-row" /> : null}</div>
      <div className="mt-3 h-11 rounded-md border border-dashed bg-background/50" />
      {variant === "dock" && dockPosition === "bottom" ? <PreviewToolbar className="absolute bottom-2 left-1/2 -translate-x-1/2 flex-row shadow-sm" /> : null}
      {variant === "dock" && dockPosition === "right" ? <PreviewToolbar className="absolute right-2 top-1/2 -translate-y-1/2 flex-col shadow-sm" /> : null}
    </div>
  )
}

function PreviewToolbar({ className }: { className?: string }) {
  return <div className={cn("flex gap-1 rounded-md border bg-background p-1", className)}>{Array.from({ length: 4 }, (_, index) => <span key={index} className="size-2.5 rounded-sm bg-muted-foreground/30" />)}</div>
}

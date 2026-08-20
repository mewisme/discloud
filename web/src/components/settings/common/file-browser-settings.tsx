import { SlidersHorizontalIcon } from "lucide-react"
import type { ReactNode } from "react"

import { SettingsRow } from "@/components/settings/common/settings-row"
import { type ToolbarDockPosition, ToolbarPreview, type ToolbarVariant } from "@/components/settings/common/toolbar-preview"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function FileBrowserSettings({
  toolbarVariant,
  toolbarDockPosition,
  onVariantChange,
  onDockPositionChange,
}: {
  toolbarVariant: ToolbarVariant
  toolbarDockPosition: ToolbarDockPosition
  onVariantChange: (variant: ToolbarVariant) => void
  onDockPositionChange: (position: ToolbarDockPosition) => void
}) {
  return (
    <Card id="file-browser" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontalIcon className="size-4" />
          File browser
        </CardTitle>
        <CardDescription>Customize how file browser controls are positioned in your workspace.</CardDescription>
      </CardHeader>

      <CardContent className="divide-y">
        <SettingsRow
          title="Toolbar layout"
          description="Keep file browser controls in the page header or move them into a floating dock."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard
              title="Inline"
              description="Keep controls beside the folder heading."
              selected={toolbarVariant === "inline"}
              onClick={() => onVariantChange("inline")}
            >
              <ToolbarPreview variant="inline" dockPosition={toolbarDockPosition} />
            </ChoiceCard>

            <ChoiceCard
              title="Dock"
              description="Keep controls floating while browsing files."
              selected={toolbarVariant === "dock"}
              onClick={() => onVariantChange("dock")}
            >
              <ToolbarPreview variant="dock" dockPosition={toolbarDockPosition} />
            </ChoiceCard>
          </div>
        </SettingsRow>

        {toolbarVariant === "dock" && (
          <SettingsRow
            title="Dock position"
            description="Choose whether the dock runs horizontally below the browser or vertically along its right side."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                title="Bottom"
                description="Horizontal floating toolbar."
                selected={toolbarDockPosition === "bottom"}
                onClick={() => onDockPositionChange("bottom")}
              >
                <ToolbarPreview variant="dock" dockPosition="bottom" />
              </ChoiceCard>

              <ChoiceCard
                title="Right"
                description="Compact vertical toolbar."
                selected={toolbarDockPosition === "right"}
                onClick={() => onDockPositionChange("right")}
              >
                <ToolbarPreview variant="dock" dockPosition="right" />
              </ChoiceCard>
            </div>
          </SettingsRow>
        )}
      </CardContent>
    </Card>
  )
}

function ChoiceCard({
  title,
  description,
  selected,
  onClick,
  children,
}: {
  title: string
  description: string
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-primary/5",
      )}
      onClick={onClick}
    >
      <div className="mb-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </button>
  )
}
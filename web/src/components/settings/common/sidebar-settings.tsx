import { PanelLeftIcon } from "lucide-react"

import { SettingsRow } from "@/components/settings/common/settings-row"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

export type SidebarSide = "left" | "right"
export type SidebarVariant = "sidebar" | "floating" | "inset"
export type SidebarCollapsible = "offcanvas" | "icon" | "none"

export function SidebarSettings({
  side,
  variant,
  collapsible,
  onSideChange,
  onVariantChange,
  onCollapsibleChange,
}: {
  side: SidebarSide
  variant: SidebarVariant
  collapsible: SidebarCollapsible
  onSideChange: (value: SidebarSide) => void
  onVariantChange: (value: SidebarVariant) => void
  onCollapsibleChange: (value: SidebarCollapsible) => void
}) {
  return (
    <Card id="sidebar" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PanelLeftIcon className="size-4" />
          Sidebar
        </CardTitle>

        <CardDescription>
          Configure the position, appearance and collapse behavior of the application sidebar.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <SettingsRow
          title="Side"
          description="Choose which side of the application contains the sidebar."
        >
          <Select value={side} onValueChange={(value) => onSideChange(value as SidebarSide)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Sidebar side">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectGroup>
                <SelectLabel>Side</SelectLabel>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          title="Variant"
          description="Control how the sidebar is visually attached to the application."
        >
          <Select value={variant} onValueChange={(value) => onVariantChange(value as SidebarVariant)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Sidebar variant">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectGroup>
                <SelectLabel>Variant</SelectLabel>
                <SelectItem value="sidebar">Sidebar</SelectItem>
                <SelectItem value="floating">Floating</SelectItem>
                <SelectItem value="inset">Inset</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          title="Collapse behavior"
          description="Choose how the sidebar behaves when it is collapsed."
          last
        >
          <Select
            value={collapsible}
            onValueChange={(value) => onCollapsibleChange(value as SidebarCollapsible)}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label="Sidebar collapse behavior">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectGroup>
                <SelectLabel>Collapse behavior</SelectLabel>
                <SelectItem value="icon">Icon rail · Recommended</SelectItem>
                <SelectItem value="offcanvas">Off-canvas</SelectItem>
                <SelectItem value="none">Always expanded</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}
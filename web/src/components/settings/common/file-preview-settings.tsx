import { ImageIcon } from "lucide-react"

import { SettingsRow } from "@/components/settings/common/settings-row"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

export function FilePreviewSettings({
  preloadNext,
  onPreloadNextChange,
}: {
  preloadNext: number
  onPreloadNextChange: (value: number) => void
}) {
  return (
    <Card id="file-preview" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="size-4" />
          File preview
        </CardTitle>
        <CardDescription>Configure how DisCloud prepares upcoming assets while navigating the preview carousel.</CardDescription>
      </CardHeader>

      <CardContent>
        <SettingsRow
          title="Preload upcoming assets"
          description="Prepare a small number of upcoming preview items so next and swipe navigation feels faster."
          last
        >
          <div className="space-y-3">
            <Select value={String(preloadNext)} onValueChange={(value) => onPreloadNextChange(Number(value))}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Upcoming assets to preload">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Upcoming assets</SelectLabel>
                  <SelectItem value="3">3 items · Recommended</SelectItem>
                  <SelectItem value="4">4 items</SelectItem>
                  <SelectItem value="5">5 items</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Images are preloaded in full. Video and audio preload metadata only. PDF and text previews warm only their initial content range.
            </p>
          </div>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}
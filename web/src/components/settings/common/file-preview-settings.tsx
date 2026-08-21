import { ImageIcon, VideoIcon } from "lucide-react"

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
          <VideoIcon className="size-4" />
          Preview preload
        </CardTitle>

        <CardDescription>
          Configure how DisCloud prepares upcoming files while navigating the preview carousel.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <SettingsRow
          title="Preload upcoming previews"
          description="Use one preload window for images, videos and other supported preview types."
          last
        >
          <div className="space-y-3">
            <Select
              value={String(preloadNext)}
              onValueChange={(value) => onPreloadNextChange(Number(value))}
            >
              <SelectTrigger
                className="w-full sm:w-56"
                aria-label="Upcoming previews to preload"
              >
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Upcoming previews</SelectLabel>
                  <SelectItem value="3">3 items · Recommended</SelectItem>
                  <SelectItem value="4">4 items</SelectItem>
                  <SelectItem value="5">5 items</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Images are loaded ahead of navigation. Videos buffer enough data to become playable instead of warming metadata only. Audio warms metadata while PDF and text previews warm their initial content range.
            </p>
          </div>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}
import { ImageIcon, VideoIcon } from "lucide-react"

import { SettingsRow } from "@/components/settings/common/settings-row"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

const preloadOptions = [3, 4, 5, 6, 7, 8, 9, 10] as const

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

                  {preloadOptions.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count} items
                    </SelectItem>
                  ))}
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
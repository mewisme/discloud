import { CircleIcon, DiamondIcon, PaletteIcon, TriangleIcon } from "lucide-react"

import { SettingsRow } from "@/components/settings/common/settings-row"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type ThemeEffect, themeEffects } from "@/lib/theme-transition"

const effectIcons: Record<ThemeEffect, typeof CircleIcon> = {
  triangle: TriangleIcon,
  "triangle-blur": TriangleIcon,
  circle: CircleIcon,
  "circle-blur": CircleIcon,
  "circle-blur-top-left": CircleIcon,
  polygon: DiamondIcon,
  "polygon-gradient": DiamondIcon,
}

export function ThemeSettings({
  effect,
  onEffectChange,
}: {
  effect: ThemeEffect
  onEffectChange: (effect: ThemeEffect) => void
}) {
  return (
    <Card id="theme" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaletteIcon className="size-4" />
          Theme
        </CardTitle>
        <CardDescription>
          Configure the visual transition used when switching between light, dark and system themes.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <SettingsRow
          title="Transition effect"
          description="Choose how the next theme is revealed when changing the appearance."
          last
        >
          <Select value={effect} onValueChange={(value) => onEffectChange(value as ThemeEffect)}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Theme transition effect">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectGroup>
                <SelectLabel>Effect</SelectLabel>
                {Object.entries(themeEffects).map(([key, item]) => {
                  const effectKey = key as ThemeEffect
                  const Icon = effectIcons[effectKey]

                  return (
                    <SelectItem key={effectKey} value={effectKey}>
                      <Icon />
                      {item.title}
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}
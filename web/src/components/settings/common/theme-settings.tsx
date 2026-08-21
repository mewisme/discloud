import { BracesIcon, CircleIcon, DiamondIcon, PaletteIcon, TriangleIcon } from "lucide-react"

import { SettingsRow } from "@/components/settings/common/settings-row"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { type ThemeEffect, themeEffects } from "@/lib/theme-transition"

const effectIcons: Record<ThemeEffect, typeof CircleIcon> = {
  triangle: TriangleIcon,
  "triangle-blur": TriangleIcon,
  circle: CircleIcon,
  "circle-blur": CircleIcon,
  "circle-blur-top-left": CircleIcon,
  polygon: DiamondIcon,
  "polygon-gradient": DiamondIcon,
  custom: BracesIcon,
}

export function ThemeSettings({
  effect,
  customCSS,
  onEffectChange,
  onCustomCSSChange,
}: {
  effect: ThemeEffect
  customCSS: string
  onEffectChange: (effect: ThemeEffect) => void
  onCustomCSSChange: (css: string) => void
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
          last={effect !== "custom"}
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
                  const label = effectKey === "custom" ? "Custom" : "title" in item ? item.title : effectKey

                  return (
                    <SelectItem key={effectKey} value={effectKey}>
                      <Icon />
                      {label}
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        {effect === "custom" && (
          <SettingsRow
            title="Custom CSS"
            description="CSS applied to the View Transition pseudo-elements when switching themes."
            last
          >
            <div className="w-full space-y-2 sm:w-[32rem]">
              <Textarea
                value={customCSS}
                onChange={(event) => onCustomCSSChange(event.target.value)}
                placeholder={`::view-transition-new(root) {\n  animation: reveal 500ms ease-out;\n}`}
                spellCheck={false}
                className="min-h-56 resize-y font-mono text-xs"
              />

              <div className="text-xs text-muted-foreground">
                Use standard View Transition selectors such as ::view-transition-old(root) and ::view-transition-new(root).
              </div>
            </div>
          </SettingsRow>
        )}
      </CardContent>
    </Card>
  )
}
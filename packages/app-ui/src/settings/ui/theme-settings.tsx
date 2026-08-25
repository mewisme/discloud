"use client"

import { type ThemeEffect, themeEffects } from "@discloud/shared/theme-transition"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@discloud/ui/components/collapsible"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Textarea } from "@discloud/ui/components/textarea"
import { BracesIcon, ChevronRightIcon, CircleIcon, DiamondIcon, ExternalLinkIcon, PaletteIcon, TriangleIcon } from "lucide-react"
import { SettingsRow } from "./settings-row"

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
const customThemeExample = `::view-transition-group(root) {
  animation-duration: 600ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}

::view-transition-old(root) {
  animation: none;
  z-index: -1;
}

::view-transition-new(root) {
  animation: reveal 600ms both;
}

@keyframes reveal {
  from {
    clip-path: circle(0 at 50% 50%);
  }

  to {
    clip-path: circle(150% at 50% 50%);
  }
}`

export function ThemeSettings({ effect, customCSS, onEffectChange, onCustomCSSChange }: {
  effect: ThemeEffect
  customCSS: string
  onEffectChange: (effect: ThemeEffect) => void
  onCustomCSSChange: (css: string) => void
}) {
  return (
    <Card id="theme" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PaletteIcon className="size-4" />Theme</CardTitle>
        <CardDescription>Configure the visual transition used when switching between light, dark and system themes.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow title="Transition effect" description="Choose how the next theme is revealed when changing the appearance." last={effect !== "custom"}>
          <Select value={effect} onValueChange={(value) => onEffectChange(value as ThemeEffect)}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Theme transition effect"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Effect</SelectLabel>
                {Object.entries(themeEffects).map(([key, item]) => {
                  const effectKey = key as ThemeEffect
                  const Icon = effectIcons[effectKey]
                  return <SelectItem key={effectKey} value={effectKey}><Icon />{item.title}</SelectItem>
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
        {effect === "custom" ? (
          <SettingsRow title="Custom CSS" description="CSS applied to the View Transition pseudo-elements when switching themes." last>
            <div className="w-full space-y-3 sm:w-[36rem]">
              <Textarea value={customCSS} onChange={(event) => onCustomCSSChange(event.target.value)} placeholder={customThemeExample} spellCheck={false} className="min-h-64 resize-y font-mono text-xs" />
              <CustomThemeCSSDocs />
            </div>
          </SettingsRow>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CustomThemeCSSDocs() {
  return (
    <Collapsible className="group/docs">
      <CollapsibleTrigger asChild><Button type="button" variant="outline" size="sm" className="w-full justify-start"><ChevronRightIcon className="transition-transform duration-200 group-data-[state=open]/docs:rotate-90" />Custom CSS reference</Button></CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-4 rounded-md border bg-muted/30 p-4 text-sm">
          <div className="space-y-2"><div className="font-medium">View Transition structure</div><pre className="overflow-x-auto rounded-md bg-background p-3 font-mono text-xs leading-relaxed"><code>{`::view-transition
└─ ::view-transition-group(root)
   └─ ::view-transition-image-pair(root)
      ├─ ::view-transition-old(root)
      └─ ::view-transition-new(root)`}</code></pre></div>
          <div className="space-y-2">
            <div className="font-medium">Useful selectors</div>
            <div className="grid gap-2 text-xs">
              <CSSReference selector="::view-transition-group(root)" description="Container for the root transition. Good place for shared duration and easing." />
              <CSSReference selector="::view-transition-image-pair(root)" description="Contains the old and new snapshots." />
              <CSSReference selector="::view-transition-old(root)" description="Snapshot of the theme before the change." />
              <CSSReference selector="::view-transition-new(root)" description="Snapshot of the new theme being revealed." />
              <CSSReference selector=".dark::view-transition-new(root)" description="Target a transition specifically when the resulting document is dark." />
            </div>
          </div>
          <div className="space-y-2"><div className="font-medium">Starter example</div><pre className="max-h-80 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-relaxed"><code>{customThemeExample}</code></pre></div>
          <div className="space-y-2">
            <div className="font-medium">Common techniques</div>
            <div className="grid gap-1.5 text-xs text-muted-foreground">
              <span>Use <code className="text-foreground">clip-path</code> for circle, polygon and directional reveals.</span>
              <span>Use <code className="text-foreground">mask</code> for custom shapes and blurred edges.</span>
              <span>Use <code className="text-foreground">transform</code> and <code className="text-foreground">opacity</code> for slides, scales and fades.</span>
              <span>Add <code className="text-foreground">animation: none</code> to the old or new snapshot when you do not want the browser&apos;s default cross-fade.</span>
              <span>Define regular <code className="text-foreground">@keyframes</code> in the same custom CSS field.</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-xs">
            <a href="https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">MDN View Transition guide<ExternalLinkIcon className="size-3" /></a>
            <a href="https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/View_transitions" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">MDN CSS reference<ExternalLinkIcon className="size-3" /></a>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function CSSReference({ selector, description }: { selector: string; description: string }) {
  return <div className="rounded-md border bg-background p-2.5"><code className="font-mono text-foreground">{selector}</code><div className="mt-1 text-muted-foreground">{description}</div></div>
}

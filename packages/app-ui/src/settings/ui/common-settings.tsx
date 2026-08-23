"use client"

import type { UserConfig } from "@discloud/api/models"
import { formatDateTime } from "@discloud/shared/format"
import { type ThemeEffect, themeEffects } from "@discloud/shared/theme-transition"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@discloud/ui/components/collapsible"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@discloud/ui/components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@discloud/ui/components/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Textarea } from "@discloud/ui/components/textarea"
import { cn } from "@discloud/ui/lib/utils"
import { BracesIcon, ChevronRightIcon, ChevronsUpDownIcon, CircleIcon, Clock3Icon, DiamondIcon, ExternalLinkIcon, ImageIcon, ListIcon, Loader2Icon, PaletteIcon, PanelLeftIcon, SlidersHorizontalIcon, TriangleIcon, VideoIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"

type CommonConfig = UserConfig["common"]
export type SidebarSide = CommonConfig["sidebar"]["side"]
export type SidebarVariant = CommonConfig["sidebar"]["variant"]
export type SidebarCollapsible = CommonConfig["sidebar"]["collapsible"]
export type ToolbarVariant = CommonConfig["fileBrowserToolbar"]["variant"]
export type ToolbarDockPosition = CommonConfig["fileBrowserToolbar"]["dockPosition"]
export type PaginationMode = CommonConfig["pagination"]["mode"]

const preloadOptions = [3, 4, 5, 6, 7, 8, 9, 10] as const
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

export function SidebarSettings({ side, variant, collapsible, onSideChange, onVariantChange, onCollapsibleChange }: {
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
        <CardTitle className="flex items-center gap-2"><PanelLeftIcon className="size-4" />Sidebar</CardTitle>
        <CardDescription>Configure the position, appearance and collapse behavior of the application sidebar.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow title="Side" description="Choose which side of the application contains the sidebar.">
          <Select value={side} onValueChange={(value) => onSideChange(value as SidebarSide)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Sidebar side"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectLabel>Side</SelectLabel><SelectItem value="left">Left</SelectItem><SelectItem value="right">Right</SelectItem></SelectGroup></SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Variant" description="Control how the sidebar is visually attached to the application.">
          <Select value={variant} onValueChange={(value) => onVariantChange(value as SidebarVariant)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Sidebar variant"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectLabel>Variant</SelectLabel><SelectItem value="sidebar">Sidebar</SelectItem><SelectItem value="floating">Floating</SelectItem><SelectItem value="inset">Inset</SelectItem></SelectGroup></SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Collapse behavior" description="Choose how the sidebar behaves when it is collapsed." last>
          <Select value={collapsible} onValueChange={(value) => onCollapsibleChange(value as SidebarCollapsible)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Sidebar collapse behavior"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectLabel>Collapse behavior</SelectLabel><SelectItem value="icon">Icon rail</SelectItem><SelectItem value="offcanvas">Off-canvas</SelectItem><SelectItem value="none">Always expanded</SelectItem></SelectGroup></SelectContent>
          </Select>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}

export function FileBrowserSettings({ toolbarVariant, toolbarDockPosition, onVariantChange, onDockPositionChange }: {
  toolbarVariant: ToolbarVariant
  toolbarDockPosition: ToolbarDockPosition
  onVariantChange: (variant: ToolbarVariant) => void
  onDockPositionChange: (position: ToolbarDockPosition) => void
}) {
  return (
    <Card id="file-browser" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SlidersHorizontalIcon className="size-4" />File browser</CardTitle>
        <CardDescription>Customize how file browser controls are positioned in your workspace.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <SettingsRow title="Toolbar layout" description="Keep file browser controls in the page header or move them into a floating dock.">
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard title="Inline" description="Keep controls beside the folder heading." selected={toolbarVariant === "inline"} onClick={() => onVariantChange("inline")}>
              <ToolbarPreview variant="inline" dockPosition={toolbarDockPosition} />
            </ChoiceCard>
            <ChoiceCard title="Dock" description="Keep controls floating while browsing files." selected={toolbarVariant === "dock"} onClick={() => onVariantChange("dock")}>
              <ToolbarPreview variant="dock" dockPosition={toolbarDockPosition} />
            </ChoiceCard>
          </div>
        </SettingsRow>

        {toolbarVariant === "dock" ? (
          <SettingsRow title="Dock position" description="Choose whether the dock runs horizontally below the browser or vertically along its right side.">
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard title="Bottom" description="Horizontal floating toolbar." selected={toolbarDockPosition === "bottom"} onClick={() => onDockPositionChange("bottom")}>
                <ToolbarPreview variant="dock" dockPosition="bottom" />
              </ChoiceCard>
              <ChoiceCard title="Right" description="Compact vertical toolbar." selected={toolbarDockPosition === "right"} onClick={() => onDockPositionChange("right")}>
                <ToolbarPreview variant="dock" dockPosition="right" />
              </ChoiceCard>
            </div>
          </SettingsRow>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function PaginationSettings({ mode, onModeChange }: { mode: PaginationMode; onModeChange: (mode: PaginationMode) => void }) {
  return (
    <Card id="pagination" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListIcon className="size-4" />Pagination</CardTitle>
        <CardDescription>Choose how DisCloud loads additional items in paginated lists.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow title="Loading behavior" description="Applies to Files, Search, Favorites, Collections, and Trash." last>
          <div className="space-y-3">
            <Select value={mode} onValueChange={(value) => { if (value === "infinite" || value === "manual") onModeChange(value) }}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Pagination loading behavior"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectLabel>Loading behavior</SelectLabel><SelectItem value="infinite">Infinite scroll</SelectItem><SelectItem value="manual">Load more button</SelectItem></SelectGroup></SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">Infinite scroll automatically loads the next page near the end of the list. Manual mode waits for you to press Load more.</p>
          </div>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}

export function FilePreviewSettings({ preloadNext, onPreloadNextChange }: { preloadNext: number; onPreloadNextChange: (value: number) => void }) {
  return (
    <Card id="file-preview" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ImageIcon className="size-4" /><VideoIcon className="size-4" />Preview preload</CardTitle>
        <CardDescription>Configure how DisCloud prepares upcoming files while navigating the preview carousel.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow title="Preload upcoming previews" description="Use one preload window for images, videos and other supported preview types." last>
          <div className="space-y-3">
            <Select value={String(preloadNext)} onValueChange={(value) => onPreloadNextChange(Number(value))}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Upcoming previews to preload"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectLabel>Upcoming previews</SelectLabel>{preloadOptions.map((count) => <SelectItem key={count} value={String(count)}>{count} items</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">Images are loaded ahead of navigation. Videos buffer enough data to become playable instead of warming metadata only. Audio warms metadata while PDF and text previews warm their initial content range.</p>
          </div>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}

export function DateTimeSettings({ timezone, onTimezoneChange }: { timezone: string; onTimezoneChange: (timezone: string) => void }) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState<Date>()
  const timezones = useMemo(() => availableTimezones(), [])

  useEffect(() => setNow(new Date()), [])

  return (
    <Card id="date-time" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Clock3Icon className="size-4" />Date and time</CardTitle>
        <CardDescription>Configure how dates and times are displayed. DisCloud continues storing and processing timestamps in UTC.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow title="Display time zone" description="Used throughout the interface when formatting timestamps." last>
          <div className="space-y-3">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button id="display-timezone" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal"><span className="truncate">{timezone}</span><ChevronsUpDownIcon className="shrink-0 text-muted-foreground" /></Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
                <Command>
                  <CommandInput placeholder="Search time zones…" />
                  <CommandList>
                    <CommandEmpty>No time zone found.</CommandEmpty>
                    {timezones.map((item) => <CommandItem key={item} value={item} data-checked={timezone === item} onSelect={() => { onTimezoneChange(item); setOpen(false) }}><span className="truncate">{item}</span></CommandItem>)}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Preview</p>
              <p className="mt-1 font-medium">{now ? formatDateTime(now, timezone) : "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{timezone}</p>
            </div>
          </div>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}

export function SettingsSaveBar({ dirty, pending, onSave }: { dirty: boolean; pending: boolean; onSave: () => void }) {
  return (
    <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{dirty ? "Unsaved changes" : "Settings are up to date"}</p>
        <p className="text-xs text-muted-foreground">{dirty ? "Save to apply these preferences across your account." : "Your common preferences are saved."}</p>
      </div>
      <Button disabled={!dirty || pending} onClick={onSave}>{pending ? <Loader2Icon className="animate-spin" /> : null}Save changes</Button>
    </div>
  )
}

function SettingsRow({ title, description, children, last = false }: { title: string; description: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("grid gap-5 py-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]", last && "pb-0 pt-0")}>
      <div><p className="text-sm font-medium">{title}</p><p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p></div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ToolbarPreview({ variant, dockPosition }: { variant: ToolbarVariant; dockPosition: ToolbarDockPosition }) {
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

function ChoiceCard({ title, description, selected, onClick, children }: { title: string; description: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} className={cn("rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected && "border-primary bg-primary/5")} onClick={onClick}>
      <div className="mb-3"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
      {children}
    </button>
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

function availableTimezones() {
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
  return [...new Set(["UTC", ...supported])].sort((left, right) => left === "UTC" ? -1 : right === "UTC" ? 1 : left.localeCompare(right))
}

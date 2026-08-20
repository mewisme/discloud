"use client"

import { ChevronsUpDownIcon, Clock3Icon, ImageIcon, Loader2Icon, SlidersHorizontalIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { useUserConfig } from "@/components/settings/user-config-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiJSON } from "@/lib/api/client"
import type { UpdateCommonConfigInput, UserConfig } from "@/lib/api/models"
import { apiErrorMessage, formatDateTime } from "@/lib/helpers"
import { cn } from "@/lib/utils"

type ToolbarConfig = UserConfig["common"]["fileBrowserToolbar"]
type ToolbarVariant = ToolbarConfig["variant"]
type ToolbarDockPosition = ToolbarConfig["dockPosition"]

export function CommonSettings() {
  const router = useRouter()
  const { config, setConfig } = useUserConfig()
  const [timezone, setTimezone] = useState(config.common.timezone || "UTC")
  const [toolbarVariant, setToolbarVariant] = useState<ToolbarVariant>(config.common.fileBrowserToolbar.variant)
  const [toolbarDockPosition, setToolbarDockPosition] = useState<ToolbarDockPosition>(config.common.fileBrowserToolbar.dockPosition)
  const [previewPreloadNext, setPreviewPreloadNext] = useState(config.common.filePreview.preloadNext)
  const [timezoneOpen, setTimezoneOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [now, setNow] = useState<Date>()
  const timezones = useMemo(() => availableTimezones(), [])
  const dirty =
    timezone !== config.common.timezone ||
    toolbarVariant !== config.common.fileBrowserToolbar.variant ||
    toolbarDockPosition !== config.common.fileBrowserToolbar.dockPosition ||
    previewPreloadNext !== config.common.filePreview.preloadNext

  useEffect(() => {
    setTimezone(config.common.timezone || "UTC")
    setToolbarVariant(config.common.fileBrowserToolbar.variant)
    setToolbarDockPosition(config.common.fileBrowserToolbar.dockPosition)
    setPreviewPreloadNext(config.common.filePreview.preloadNext)
  }, [
    config.common.timezone,
    config.common.fileBrowserToolbar.variant,
    config.common.fileBrowserToolbar.dockPosition,
    config.common.filePreview.preloadNext,
  ])

  useEffect(() => {
    setNow(new Date())
  }, [])

  async function save() {
    setPending(true)

    try {
      const input = {
        timezone,
        fileBrowserToolbar: {
          variant: toolbarVariant,
          dockPosition: toolbarDockPosition,
        },
        filePreview: {
          preloadNext: previewPreloadNext,
        },
      } satisfies UpdateCommonConfigInput
      const next = await apiJSON<UserConfig>("/me/config/common", {
        method: "PUT",
        body: input,
      })

      setConfig(next)
      toast.success("Common settings updated")
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update common settings."))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <Card id="file-browser" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontalIcon className="size-4" />
            File browser
          </CardTitle>
          <CardDescription>
            Customize how file browser controls are positioned in your workspace.
          </CardDescription>
        </CardHeader>

        <CardContent className="divide-y">
          <SettingRow
            title="Toolbar layout"
            description="Keep file browser controls in the page header or move them into a floating dock."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                title="Inline"
                description="Keep controls beside the folder heading."
                selected={toolbarVariant === "inline"}
                onClick={() => setToolbarVariant("inline")}
              >
                <ToolbarPreview variant="inline" dockPosition={toolbarDockPosition} />
              </ChoiceCard>

              <ChoiceCard
                title="Dock"
                description="Keep controls floating while browsing files."
                selected={toolbarVariant === "dock"}
                onClick={() => setToolbarVariant("dock")}
              >
                <ToolbarPreview variant="dock" dockPosition={toolbarDockPosition} />
              </ChoiceCard>
            </div>
          </SettingRow>

          {toolbarVariant === "dock" && (
            <SettingRow
              title="Dock position"
              description="Choose whether the dock runs horizontally below the browser or vertically along its right side."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  title="Bottom"
                  description="Horizontal floating toolbar."
                  selected={toolbarDockPosition === "bottom"}
                  onClick={() => setToolbarDockPosition("bottom")}
                >
                  <ToolbarPreview variant="dock" dockPosition="bottom" />
                </ChoiceCard>

                <ChoiceCard
                  title="Right"
                  description="Compact vertical toolbar."
                  selected={toolbarDockPosition === "right"}
                  onClick={() => setToolbarDockPosition("right")}
                >
                  <ToolbarPreview variant="dock" dockPosition="right" />
                </ChoiceCard>
              </div>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      <Card id="file-preview" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="size-4" />
            File preview
          </CardTitle>
          <CardDescription>
            Configure how DisCloud prepares upcoming assets while navigating the preview carousel.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <SettingRow
            title="Preload upcoming assets"
            description="Prepare a small number of upcoming preview items so next and swipe navigation feels faster."
            last
          >
            <div className="space-y-3">
              <Select
                value={String(previewPreloadNext)}
                onValueChange={(value) => setPreviewPreloadNext(Number(value))}
              >
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
          </SettingRow>
        </CardContent>
      </Card>

      <Card id="date-time" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3Icon className="size-4" />
            Date and time
          </CardTitle>
          <CardDescription>
            Configure how dates and times are displayed. DisCloud continues storing and processing timestamps in UTC.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <SettingRow
            title="Display time zone"
            description="Used throughout the interface when formatting timestamps."
            last
          >
            <div className="space-y-3">
              <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen}>
                <PopoverTrigger asChild>
                  <Button id="display-timezone" variant="outline" role="combobox" aria-expanded={timezoneOpen} className="w-full justify-between font-normal">
                    <span className="truncate">{timezone}</span>
                    <ChevronsUpDownIcon className="shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>

                <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
                  <Command>
                    <CommandInput placeholder="Search time zones…" />
                    <CommandList>
                      <CommandEmpty>No time zone found.</CommandEmpty>
                      {timezones.map((item) => (
                        <CommandItem
                          key={item}
                          value={item}
                          data-checked={timezone === item}
                          onSelect={() => {
                            setTimezone(item)
                            setTimezoneOpen(false)
                          }}
                        >
                          <span className="truncate">{item}</span>
                        </CommandItem>
                      ))}
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
          </SettingRow>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{dirty ? "Unsaved changes" : "Settings are up to date"}</p>
          <p className="text-xs text-muted-foreground">
            {dirty ? "Save to apply these preferences across your account." : "Your common preferences are saved."}
          </p>
        </div>

        <Button disabled={!dirty || pending} onClick={() => void save()}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  )
}

function SettingRow({
  title,
  description,
  children,
  last = false,
}: {
  title: string
  description: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <div className={cn("grid gap-5 py-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]", last && "pb-0 pt-0")}>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
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

function ToolbarPreview({
  variant,
  dockPosition,
}: {
  variant: ToolbarVariant
  dockPosition: ToolbarDockPosition
}) {
  return (
    <div className="relative h-24 overflow-hidden rounded-lg border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="h-2.5 w-16 rounded-full bg-muted-foreground/20" />
        {variant === "inline" && <PreviewToolbar className="flex-row" />}
      </div>

      <div className="mt-3 h-11 rounded-md border border-dashed bg-background/50" />

      {variant === "dock" && dockPosition === "bottom" && (
        <PreviewToolbar className="absolute bottom-2 left-1/2 -translate-x-1/2 flex-row shadow-sm" />
      )}

      {variant === "dock" && dockPosition === "right" && (
        <PreviewToolbar className="absolute right-2 top-1/2 -translate-y-1/2 flex-col shadow-sm" />
      )}
    </div>
  )
}

function PreviewToolbar({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-1 rounded-md border bg-background p-1", className)}>
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
      <span className="size-2.5 rounded-sm bg-muted-foreground/30" />
    </div>
  )
}

function availableTimezones() {
  const supported = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : []

  return [...new Set(["UTC", ...supported])].sort((left, right) => {
    if (left === "UTC") return -1
    if (right === "UTC") return 1
    return left.localeCompare(right)
  })
}
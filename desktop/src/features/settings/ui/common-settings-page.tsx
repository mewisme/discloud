import type { UpdateCommonConfigInput, UserConfig } from "@discloud/api/models"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Textarea } from "@discloud/ui/components/textarea"
import { Clock3Icon, ImageIcon, ListIcon, Loader2Icon, PaletteIcon, PanelLeftIcon, SaveIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"

import { updateCommonConfig } from "../core/config"
import { useDesktopUserConfig } from "./user-config-provider"

type CommonConfig = UserConfig["common"]
type ThemeEffect = CommonConfig["theme"]["effect"]
type SidebarSide = CommonConfig["sidebar"]["side"]
type SidebarVariant = CommonConfig["sidebar"]["variant"]
type SidebarCollapsible = CommonConfig["sidebar"]["collapsible"]
type ToolbarVariant = CommonConfig["fileBrowserToolbar"]["variant"]
type ToolbarDockPosition = CommonConfig["fileBrowserToolbar"]["dockPosition"]
type PaginationMode = CommonConfig["pagination"]["mode"]

const preloadOptions = [3, 4, 5, 6, 7, 8, 9, 10] as const

const themeEffects: { value: ThemeEffect; label: string }[] = [
  { value: "triangle", label: "Triangle" },
  { value: "triangle-blur", label: "Triangle Blur" },
  { value: "circle", label: "Circle" },
  { value: "circle-blur", label: "Circle Blur" },
  { value: "circle-blur-top-left", label: "Circle Blur Top Left" },
  { value: "polygon", label: "Polygon" },
  { value: "polygon-gradient", label: "Polygon Gradient" },
  { value: "custom", label: "Custom" },
]

export function DesktopCommonSettingsPage() {
  const { config, loading, error, setConfig, reload } = useDesktopUserConfig()

  if (loading && !config) return <LoadingState />

  if (!config) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-3xl">
        <TriangleAlertIcon />
        <AlertTitle>Settings unavailable</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error ?? "Could not load settings."}</p>
          <Button size="sm" variant="outline" onClick={reload}>Try again</Button>
        </AlertDescription>
      </Alert>
    )
  }

  return <CommonSettingsForm config={config} onUpdated={setConfig} />
}

function CommonSettingsForm({ config, onUpdated }: { config: UserConfig; onUpdated: (config: UserConfig) => void }) {
  const stored = config.common
  const [timezone, setTimezone] = useState(stored.timezone || "UTC")
  const [themeEffect, setThemeEffect] = useState(stored.theme.effect)
  const [themeCustomCSS, setThemeCustomCSS] = useState(stored.theme.custom.css)
  const [toolbarVariant, setToolbarVariant] = useState(stored.fileBrowserToolbar.variant)
  const [toolbarDockPosition, setToolbarDockPosition] = useState(stored.fileBrowserToolbar.dockPosition)
  const [paginationMode, setPaginationMode] = useState(stored.pagination.mode)
  const [previewPreloadNext, setPreviewPreloadNext] = useState(stored.filePreview.preloadNext)
  const [sidebarSide, setSidebarSide] = useState(stored.sidebar.side)
  const [sidebarVariant, setSidebarVariant] = useState(stored.sidebar.variant)
  const [sidebarCollapsible, setSidebarCollapsible] = useState(stored.sidebar.collapsible)
  const [pending, setPending] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setTimezone(stored.timezone || "UTC")
    setThemeEffect(stored.theme.effect)
    setThemeCustomCSS(stored.theme.custom.css)
    setToolbarVariant(stored.fileBrowserToolbar.variant)
    setToolbarDockPosition(stored.fileBrowserToolbar.dockPosition)
    setPaginationMode(stored.pagination.mode)
    setPreviewPreloadNext(stored.filePreview.preloadNext)
    setSidebarSide(stored.sidebar.side)
    setSidebarVariant(stored.sidebar.variant)
    setSidebarCollapsible(stored.sidebar.collapsible)
  }, [stored])

  const dirty = timezone !== stored.timezone
    || themeEffect !== stored.theme.effect
    || themeCustomCSS !== stored.theme.custom.css
    || toolbarVariant !== stored.fileBrowserToolbar.variant
    || toolbarDockPosition !== stored.fileBrowserToolbar.dockPosition
    || paginationMode !== stored.pagination.mode
    || previewPreloadNext !== stored.filePreview.preloadNext
    || sidebarSide !== stored.sidebar.side
    || sidebarVariant !== stored.sidebar.variant
    || sidebarCollapsible !== stored.sidebar.collapsible

  async function save() {
    if (!dirty || pending) return

    try {
      new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date())
    } catch {
      setSaveError("Enter a valid IANA time zone, for example Asia/Bangkok or UTC.")
      return
    }

    setPending(true)
    setSaveError(undefined)
    setSaved(false)

    try {
      const input = {
        timezone,
        theme: { effect: themeEffect, custom: { css: themeCustomCSS } },
        fileBrowserToolbar: { variant: toolbarVariant, dockPosition: toolbarDockPosition },
        pagination: { mode: paginationMode },
        filePreview: { preloadNext: previewPreloadNext },
        sidebar: { side: sidebarSide, variant: sidebarVariant, collapsible: sidebarCollapsible },
      } satisfies UpdateCommonConfigInput

      onUpdated(await updateCommonConfig(input))
      setSaved(true)
    } catch (cause) {
      setSaveError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-20">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Common</h1>
        <p className="text-sm text-muted-foreground">Customize the general appearance and behavior of DisCloud.</p>
      </div>

      {saveError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not save settings</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsCard icon={<PaletteIcon />} title="Theme" description="Configure the transition used when switching appearance.">
        <SettingsRow title="Transition effect" description="Choose how the next theme is revealed.">
          <Select value={themeEffect} onValueChange={(value) => setThemeEffect(value as ThemeEffect)}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>{themeEffects.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </SettingsRow>
        {themeEffect === "custom" ? (
          <SettingsRow title="Custom CSS" description="CSS for View Transition pseudo-elements." last>
            <Textarea value={themeCustomCSS} spellCheck={false} className="min-h-48 w-full font-mono text-xs sm:w-[32rem]" onChange={(event) => setThemeCustomCSS(event.target.value)} />
          </SettingsRow>
        ) : null}
      </SettingsCard>

      <SettingsCard icon={<PanelLeftIcon />} title="Sidebar" description="Configure position, appearance and collapse behavior.">
        <SettingsRow title="Side" description="Choose which side contains the sidebar.">
          <Select value={sidebarSide} onValueChange={(value) => setSidebarSide(value as SidebarSide)}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="left">Left</SelectItem><SelectItem value="right">Right</SelectItem></SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Variant" description="Choose how the sidebar is attached.">
          <Select value={sidebarVariant} onValueChange={(value) => setSidebarVariant(value as SidebarVariant)}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="sidebar">Sidebar</SelectItem><SelectItem value="floating">Floating</SelectItem><SelectItem value="inset">Inset</SelectItem></SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Collapse behavior" description="Choose how the sidebar collapses." last>
          <Select value={sidebarCollapsible} onValueChange={(value) => setSidebarCollapsible(value as SidebarCollapsible)}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="icon">Icon rail</SelectItem><SelectItem value="offcanvas">Off-canvas</SelectItem><SelectItem value="none">Always expanded</SelectItem></SelectContent>
          </Select>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard icon={<SlidersHorizontalIcon />} title="File browser" description="Configure the file browser toolbar layout.">
        <SettingsRow title="Toolbar layout" description="Keep controls inline or place them in a dock.">
          <Select value={toolbarVariant} onValueChange={(value) => setToolbarVariant(value as ToolbarVariant)}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="inline">Inline</SelectItem><SelectItem value="dock">Dock</SelectItem></SelectContent>
          </Select>
        </SettingsRow>
        {toolbarVariant === "dock" ? (
          <SettingsRow title="Dock position" description="Choose the dock position." last>
            <Select value={toolbarDockPosition} onValueChange={(value) => setToolbarDockPosition(value as ToolbarDockPosition)}>
              <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="bottom">Bottom</SelectItem><SelectItem value="right">Right</SelectItem></SelectContent>
            </Select>
          </SettingsRow>
        ) : null}
      </SettingsCard>

      <SettingsCard icon={<ListIcon />} title="Pagination" description="Choose how additional pages are loaded.">
        <SettingsRow title="Loading behavior" description="Used by paginated desktop views." last>
          <Select value={paginationMode} onValueChange={(value) => setPaginationMode(value as PaginationMode)}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="infinite">Infinite scroll</SelectItem><SelectItem value="manual">Load more button</SelectItem></SelectContent>
          </Select>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard icon={<ImageIcon />} title="File preview" description="Configure preview preloading.">
        <SettingsRow title="Preload next" description="Number of upcoming previews to prepare." last>
          <Select value={String(previewPreloadNext)} onValueChange={(value) => setPreviewPreloadNext(Number(value))}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>{preloadOptions.map((count) => <SelectItem key={count} value={String(count)}>{count} items</SelectItem>)}</SelectContent>
          </Select>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard icon={<Clock3Icon />} title="Date and time" description="Configure the time zone used for display.">
        <SettingsRow title="Time zone" description="Use an IANA time zone such as Asia/Bangkok or UTC." last>
          <div className="w-full space-y-2 sm:w-64">
            <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            <p className="text-xs text-muted-foreground">{timezonePreview(timezone)}</p>
          </div>
        </SettingsRow>
      </SettingsCard>

      <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <p className="min-w-0 text-sm text-muted-foreground">{dirty ? "You have unsaved changes." : saved ? "Settings saved." : "Settings are up to date."}</p>
        <Button disabled={!dirty || pending} onClick={() => void save()}>
          {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  )
}

function SettingsCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 [&>svg]:size-4">{icon}{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function SettingsRow({ title, description, children, last = false }: { title: string; description: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start ${last ? "" : "border-b"} first:pt-0 last:pb-0`}>
      <div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
      <div className="min-w-0 sm:flex sm:justify-end">{children}</div>
    </div>
  )
}

function LoadingState() {
  return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" />Loading settings</div></div>
}

function timezonePreview(timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium", timeZone: timezone }).format(new Date())
  } catch {
    return "Invalid time zone"
  }
}

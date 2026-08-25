import type { UpdateCommonConfigInput, UserConfig } from "@discloud/api/models"
import { DateTimeSettings } from "@discloud/app-ui/settings/date-time-settings"
import { FileBrowserSettings, type ToolbarDockPosition, type ToolbarVariant } from "@discloud/app-ui/settings/file-browser-settings"
import { FilePreviewSettings } from "@discloud/app-ui/settings/file-preview-settings"
import { type PaginationMode, PaginationSettings } from "@discloud/app-ui/settings/pagination-settings"
import { SettingsSaveBar } from "@discloud/app-ui/settings/settings-save-bar"
import { type SidebarCollapsible, SidebarSettings, type SidebarSide, type SidebarVariant } from "@discloud/app-ui/settings/sidebar-settings"
import { ThemeSettings } from "@discloud/app-ui/settings/theme-settings"
import type { ThemeEffect } from "@discloud/shared/theme-transition"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"

import { updateCommonConfig } from "../core/config"
import { useDesktopUserConfig } from "./user-config-provider"

export function DesktopCommonSettingsPage() {
  const { config, loading, error, setConfig, reload } = useDesktopUserConfig()

  if (loading && !config) return <LoadingState />

  if (!config) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-3xl">
        <TriangleAlertIcon />
        <AlertTitle>Settings unavailable</AlertTitle>
        <AlertDescription className="space-y-3"><p>{error ?? "Could not load settings."}</p><Button size="sm" variant="outline" onClick={reload}>Try again</Button></AlertDescription>
      </Alert>
    )
  }

  return <CommonSettingsForm config={config} onUpdated={setConfig} />
}

function CommonSettingsForm({ config, onUpdated }: { config: UserConfig; onUpdated: (config: UserConfig) => void }) {
  const stored = config.common
  const [timezone, setTimezone] = useState(stored.timezone || "UTC")
  const [themeEffect, setThemeEffect] = useState<ThemeEffect>(stored.theme.effect)
  const [themeCustomCSS, setThemeCustomCSS] = useState(stored.theme.custom.css)
  const [toolbarVariant, setToolbarVariant] = useState<ToolbarVariant>(stored.fileBrowserToolbar.variant)
  const [toolbarDockPosition, setToolbarDockPosition] = useState<ToolbarDockPosition>(stored.fileBrowserToolbar.dockPosition)
  const [paginationMode, setPaginationMode] = useState<PaginationMode>(stored.pagination.mode)
  const [previewPreloadNext, setPreviewPreloadNext] = useState(stored.filePreview.preloadNext)
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>(stored.sidebar.side)
  const [sidebarVariant, setSidebarVariant] = useState<SidebarVariant>(stored.sidebar.variant)
  const [sidebarCollapsible, setSidebarCollapsible] = useState<SidebarCollapsible>(stored.sidebar.collapsible)
  const [pending, setPending] = useState(false)
  const [saveError, setSaveError] = useState<string>()
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
  }, [stored.timezone, stored.theme.effect, stored.theme.custom.css, stored.fileBrowserToolbar.variant, stored.fileBrowserToolbar.dockPosition, stored.pagination.mode, stored.filePreview.preloadNext, stored.sidebar.side, stored.sidebar.variant, stored.sidebar.collapsible])

  async function save() {
    if (!dirty || pending) return

    setPending(true)
    setSaveError(undefined)

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
    } catch (cause) {
      setSaveError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Common</h1>
        <p className="text-sm text-muted-foreground">Customize the general appearance and behavior of your DisCloud workspace.</p>
      </div>

      {saveError ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Could not save settings</AlertTitle><AlertDescription>{saveError}</AlertDescription></Alert> : null}

      <div className="min-w-0 space-y-6">
        <ThemeSettings effect={themeEffect} customCSS={themeCustomCSS} onEffectChange={setThemeEffect} onCustomCSSChange={setThemeCustomCSS} />
        <SidebarSettings side={sidebarSide} variant={sidebarVariant} collapsible={sidebarCollapsible} onSideChange={setSidebarSide} onVariantChange={setSidebarVariant} onCollapsibleChange={setSidebarCollapsible} />
        <FileBrowserSettings toolbarVariant={toolbarVariant} toolbarDockPosition={toolbarDockPosition} onVariantChange={setToolbarVariant} onDockPositionChange={setToolbarDockPosition} />
        <PaginationSettings mode={paginationMode} onModeChange={setPaginationMode} />
        <FilePreviewSettings preloadNext={previewPreloadNext} onPreloadNextChange={setPreviewPreloadNext} />
        <DateTimeSettings timezone={timezone} onTimezoneChange={setTimezone} />
        <SettingsSaveBar dirty={dirty} pending={pending} onSave={() => void save()} />
      </div>
    </div>
  )
}

function LoadingState() {
  return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" />Loading settings</div></div>
}

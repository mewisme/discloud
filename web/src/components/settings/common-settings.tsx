"use client"

import { DateTimeSettings } from "@discloud/app-ui/settings/date-time-settings"
import { FileBrowserSettings, type ToolbarDockPosition, type ToolbarVariant } from "@discloud/app-ui/settings/file-browser-settings"
import { FilePreviewSettings } from "@discloud/app-ui/settings/file-preview-settings"
import { type PaginationMode, PaginationSettings } from "@discloud/app-ui/settings/pagination-settings"
import { SettingsSaveBar } from "@discloud/app-ui/settings/settings-save-bar"
import { type SidebarCollapsible, SidebarSettings, type SidebarSide, type SidebarVariant } from "@discloud/app-ui/settings/sidebar-settings"
import { ThemeSettings } from "@discloud/app-ui/settings/theme-settings"
import type { ThemeEffect } from "@discloud/shared/theme-transition"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"

import { useSetUserConfig, useUserConfigSelector } from "@/components/settings/user-config-context"
import { apiJSON } from "@/lib/api/client"
import type { UpdateCommonConfigInput, UserConfig } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export function CommonSettings() {
  const router = useRouter()
  const stored = useUserConfigSelector(
    useShallow((config: UserConfig) => ({
      timezone: config.common.timezone,
      themeEffect: config.common.theme.effect,
      themeCustomCSS: config.common.theme.custom.css,
      toolbarVariant: config.common.fileBrowserToolbar.variant,
      toolbarDockPosition: config.common.fileBrowserToolbar.dockPosition,
      paginationMode: config.common.pagination.mode,
      previewPreloadNext: config.common.filePreview.preloadNext,
      sidebarSide: config.common.sidebar.side,
      sidebarVariant: config.common.sidebar.variant,
      sidebarCollapsible: config.common.sidebar.collapsible,
    })),
  )
  const setConfig = useSetUserConfig()
  const [timezone, setTimezone] = useState(stored.timezone || "UTC")
  const [themeEffect, setThemeEffect] = useState<ThemeEffect>(stored.themeEffect)
  const [themeCustomCSS, setThemeCustomCSS] = useState(stored.themeCustomCSS)
  const [toolbarVariant, setToolbarVariant] = useState<ToolbarVariant>(stored.toolbarVariant)
  const [toolbarDockPosition, setToolbarDockPosition] = useState<ToolbarDockPosition>(stored.toolbarDockPosition)
  const [paginationMode, setPaginationMode] = useState<PaginationMode>(stored.paginationMode)
  const [previewPreloadNext, setPreviewPreloadNext] = useState(stored.previewPreloadNext)
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>(stored.sidebarSide)
  const [sidebarVariant, setSidebarVariant] = useState<SidebarVariant>(stored.sidebarVariant)
  const [sidebarCollapsible, setSidebarCollapsible] = useState<SidebarCollapsible>(stored.sidebarCollapsible)
  const [pending, setPending] = useState(false)
  const dirty = timezone !== stored.timezone
    || themeEffect !== stored.themeEffect
    || themeCustomCSS !== stored.themeCustomCSS
    || toolbarVariant !== stored.toolbarVariant
    || toolbarDockPosition !== stored.toolbarDockPosition
    || paginationMode !== stored.paginationMode
    || previewPreloadNext !== stored.previewPreloadNext
    || sidebarSide !== stored.sidebarSide
    || sidebarVariant !== stored.sidebarVariant
    || sidebarCollapsible !== stored.sidebarCollapsible

  useEffect(() => {
    setTimezone(stored.timezone || "UTC")
    setThemeEffect(stored.themeEffect)
    setThemeCustomCSS(stored.themeCustomCSS)
    setToolbarVariant(stored.toolbarVariant)
    setToolbarDockPosition(stored.toolbarDockPosition)
    setPaginationMode(stored.paginationMode)
    setPreviewPreloadNext(stored.previewPreloadNext)
    setSidebarSide(stored.sidebarSide)
    setSidebarVariant(stored.sidebarVariant)
    setSidebarCollapsible(stored.sidebarCollapsible)
  }, [stored.timezone, stored.themeEffect, stored.themeCustomCSS, stored.toolbarVariant, stored.toolbarDockPosition, stored.paginationMode, stored.previewPreloadNext, stored.sidebarSide, stored.sidebarVariant, stored.sidebarCollapsible])

  async function save() {
    setPending(true)

    try {
      const input = {
        timezone,
        theme: { effect: themeEffect, custom: { css: themeCustomCSS } },
        fileBrowserToolbar: { variant: toolbarVariant, dockPosition: toolbarDockPosition },
        pagination: { mode: paginationMode },
        filePreview: { preloadNext: previewPreloadNext },
        sidebar: { side: sidebarSide, variant: sidebarVariant, collapsible: sidebarCollapsible },
      } satisfies UpdateCommonConfigInput

      const next = await apiJSON<UserConfig>("/me/config/common", { method: "PUT", body: input })
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
      <ThemeSettings effect={themeEffect} customCSS={themeCustomCSS} onEffectChange={setThemeEffect} onCustomCSSChange={setThemeCustomCSS} />
      <SidebarSettings side={sidebarSide} variant={sidebarVariant} collapsible={sidebarCollapsible} onSideChange={setSidebarSide} onVariantChange={setSidebarVariant} onCollapsibleChange={setSidebarCollapsible} />
      <FileBrowserSettings toolbarVariant={toolbarVariant} toolbarDockPosition={toolbarDockPosition} onVariantChange={setToolbarVariant} onDockPositionChange={setToolbarDockPosition} />
      <PaginationSettings mode={paginationMode} onModeChange={setPaginationMode} />
      <FilePreviewSettings preloadNext={previewPreloadNext} onPreloadNextChange={setPreviewPreloadNext} />
      <DateTimeSettings timezone={timezone} onTimezoneChange={setTimezone} />
      <SettingsSaveBar dirty={dirty} pending={pending} onSave={() => void save()} />
    </div>
  )
}

"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { DateTimeSettings } from "@/components/settings/common/date-time-settings"
import { FileBrowserSettings } from "@/components/settings/common/file-browser-settings"
import { FilePreviewSettings } from "@/components/settings/common/file-preview-settings"
import { SettingsSaveBar } from "@/components/settings/common/settings-save-bar"
import { type SidebarCollapsible, SidebarSettings, type SidebarSide, type SidebarVariant } from "@/components/settings/common/sidebar-settings"
import { ThemeSettings } from "@/components/settings/common/theme-settings"
import type { ToolbarDockPosition, ToolbarVariant } from "@/components/settings/common/toolbar-preview"
import { useUserConfig } from "@/components/settings/user-config-context"
import { apiJSON } from "@/lib/api/client"
import type { UpdateCommonConfigInput, UserConfig } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"
import type { ThemeEffect } from "@/lib/theme-transition"

export function CommonSettings() {
  const router = useRouter()
  const { config, setConfig } = useUserConfig()
  const [timezone, setTimezone] = useState(config.common.timezone || "UTC")
  const [themeEffect, setThemeEffect] = useState<ThemeEffect>(config.common.theme.effect)
  const [themeCustomCSS, setThemeCustomCSS] = useState(config.common.theme.custom.css)
  const [toolbarVariant, setToolbarVariant] = useState<ToolbarVariant>(config.common.fileBrowserToolbar.variant)
  const [toolbarDockPosition, setToolbarDockPosition] = useState<ToolbarDockPosition>(config.common.fileBrowserToolbar.dockPosition)
  const [previewPreloadNext, setPreviewPreloadNext] = useState(config.common.filePreview.preloadNext)
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>(config.common.sidebar.side)
  const [sidebarVariant, setSidebarVariant] = useState<SidebarVariant>(config.common.sidebar.variant)
  const [sidebarCollapsible, setSidebarCollapsible] = useState<SidebarCollapsible>(config.common.sidebar.collapsible)
  const [pending, setPending] = useState(false)
  const dirty = timezone !== config.common.timezone
    || themeEffect !== config.common.theme.effect
    || themeCustomCSS !== config.common.theme.custom.css
    || toolbarVariant !== config.common.fileBrowserToolbar.variant
    || toolbarDockPosition !== config.common.fileBrowserToolbar.dockPosition
    || previewPreloadNext !== config.common.filePreview.preloadNext
    || sidebarSide !== config.common.sidebar.side
    || sidebarVariant !== config.common.sidebar.variant
    || sidebarCollapsible !== config.common.sidebar.collapsible

  useEffect(() => {
    setTimezone(config.common.timezone || "UTC")
    setThemeEffect(config.common.theme.effect)
    setThemeCustomCSS(config.common.theme.custom.css)
    setToolbarVariant(config.common.fileBrowserToolbar.variant)
    setToolbarDockPosition(config.common.fileBrowserToolbar.dockPosition)
    setPreviewPreloadNext(config.common.filePreview.preloadNext)
    setSidebarSide(config.common.sidebar.side)
    setSidebarVariant(config.common.sidebar.variant)
    setSidebarCollapsible(config.common.sidebar.collapsible)
  }, [
    config.common.timezone,
    config.common.theme.effect,
    config.common.theme.custom.css,
    config.common.fileBrowserToolbar.variant,
    config.common.fileBrowserToolbar.dockPosition,
    config.common.filePreview.preloadNext,
    config.common.sidebar.side,
    config.common.sidebar.variant,
    config.common.sidebar.collapsible,
  ])

  async function save() {
    setPending(true)

    try {
      const input = {
        timezone,
        theme: {
          effect: themeEffect,
          custom: {
            css: themeCustomCSS,
          },
        },
        fileBrowserToolbar: {
          variant: toolbarVariant,
          dockPosition: toolbarDockPosition,
        },
        filePreview: {
          preloadNext: previewPreloadNext,
        },
        sidebar: {
          side: sidebarSide,
          variant: sidebarVariant,
          collapsible: sidebarCollapsible,
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
      <ThemeSettings
        effect={themeEffect}
        customCSS={themeCustomCSS}
        onEffectChange={setThemeEffect}
        onCustomCSSChange={setThemeCustomCSS}
      />

      <SidebarSettings
        side={sidebarSide}
        variant={sidebarVariant}
        collapsible={sidebarCollapsible}
        onSideChange={setSidebarSide}
        onVariantChange={setSidebarVariant}
        onCollapsibleChange={setSidebarCollapsible}
      />

      <FileBrowserSettings
        toolbarVariant={toolbarVariant}
        toolbarDockPosition={toolbarDockPosition}
        onVariantChange={setToolbarVariant}
        onDockPositionChange={setToolbarDockPosition}
      />

      <FilePreviewSettings
        preloadNext={previewPreloadNext}
        onPreloadNextChange={setPreviewPreloadNext}
      />

      <DateTimeSettings
        timezone={timezone}
        onTimezoneChange={setTimezone}
      />

      <SettingsSaveBar
        dirty={dirty}
        pending={pending}
        onSave={() => void save()}
      />
    </div>
  )
}
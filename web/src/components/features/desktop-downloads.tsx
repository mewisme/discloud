"use client"

import { formatBytes } from "@discloud/shared/format"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { AppleIcon, DownloadIcon, ExternalLinkIcon, LaptopIcon, PackageIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type { DesktopArchitecture, DesktopInstaller, DesktopPlatform, DesktopRelease } from "@/lib/releases/desktop"

type DetectedPlatform = { platform: DesktopPlatform; architecture?: DesktopArchitecture }
type NavigatorUAData = { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }> }

const PLATFORM_META = {
  windows: { label: "Windows", icon: LaptopIcon },
  macos: { label: "macOS", icon: AppleIcon },
  linux: { label: "Linux", icon: PackageIcon },
} satisfies Record<DesktopPlatform, { label: string; icon: typeof LaptopIcon }>

const PLATFORMS: DesktopPlatform[] = ["windows", "macos", "linux"]

export function DesktopDownloads({ release }: { release: DesktopRelease | null }) {
  const [detected, setDetected] = useState<DetectedPlatform | null>()
  useEffect(() => { void detectPlatform().then(setDetected) }, [])
  const recommended = useMemo(() => release && detected ? rankInstallers(release.installers.filter((installer) => installer.platform === detected.platform), detected.architecture) : [], [detected, release])

  return (
    <section id="desktop" className="border-y bg-muted/25">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <Badge variant="secondary">Desktop app</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-balance sm:text-4xl">Keep browser access. Add native workflows.</h2>
            <p className="mt-4 max-w-xl leading-7 text-muted-foreground">Desktop adds folder sync, native transfer queues, local thumbnails, tray integration, system notifications and signed updates while connecting to the same DisCloud server.</p>
            {release ? <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{release.tag}</span>{release.prerelease ? <Badge variant="outline">Pre-release</Badge> : <Badge variant="outline">Stable</Badge>}<a href={release.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">Release notes<ExternalLinkIcon className="size-3.5" /></a></div> : null}
          </div>

          <div className="space-y-4">
            {detected === undefined ? <Card><CardContent className="flex min-h-28 items-center gap-3 p-5 text-sm text-muted-foreground"><DownloadIcon className="size-4" />Detecting your platform…</CardContent></Card> : detected ? <RecommendedInstall detected={detected} installers={recommended} release={release} /> : <Card><CardContent className="flex min-h-28 items-center gap-3 p-5 text-sm text-muted-foreground"><DownloadIcon className="size-4" />Choose a Windows, macOS or Linux installer below.</CardContent></Card>}
            <div className="grid gap-3 md:grid-cols-3">{PLATFORMS.map((platform) => <PlatformInstallers key={platform} platform={platform} installers={release?.installers.filter((installer) => installer.platform === platform) ?? []} recommended={detected?.platform === platform} />)}</div>
            {!release || release.installers.length === 0 ? <p className="text-xs leading-5 text-muted-foreground">No desktop installer is attached to the currently published releases yet. This page filters GitHub Release assets automatically and will expose signed Tauri bundles as soon as the release pipeline publishes them.</p> : <p className="text-xs text-muted-foreground">All downloads come directly from the selected GitHub Release. Updater signatures and backend archives are intentionally hidden.</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

function RecommendedInstall({ detected, installers, release }: { detected: DetectedPlatform; installers: DesktopInstaller[]; release: DesktopRelease | null }) {
  const meta = PLATFORM_META[detected.platform]
  const Icon = meta.icon
  return (
    <Card className="border-foreground/20 bg-background">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background"><Icon className="size-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Recommended for {meta.label}</p><Badge>Detected</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">{detected.architecture ? `${architectureLabel(detected.architecture)} detected` : "Choose the installer that matches your architecture"}</p></div></div>
        {installers.length > 0 ? <div className="flex flex-wrap gap-2">{installers.slice(0, 2).map((installer) => <DownloadButton key={installer.url} installer={installer} compact />)}</div> : <Button variant="outline" asChild><a href={release?.url ?? "https://github.com/mewisme/discloud/releases"} target="_blank" rel="noreferrer">View releases<ExternalLinkIcon data-icon="inline-end" /></a></Button>}
      </CardContent>
    </Card>
  )
}

function PlatformInstallers({ platform, installers, recommended }: { platform: DesktopPlatform; installers: DesktopInstaller[]; recommended: boolean }) {
  const meta = PLATFORM_META[platform]
  const Icon = meta.icon
  return (
    <Card className={recommended ? "border-foreground/20" : undefined}>
      <CardHeader className="pb-3"><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon className="size-4" />{meta.label}</CardTitle>{recommended ? <Badge variant="secondary">Your OS</Badge> : null}</div></CardHeader>
      <CardContent className="space-y-2">{installers.length > 0 ? rankInstallers(installers).map((installer) => <DownloadButton key={installer.url} installer={installer} />) : <p className="py-2 text-xs text-muted-foreground">No installer published.</p>}</CardContent>
    </Card>
  )
}

function DownloadButton({ installer, compact = false }: { installer: DesktopInstaller; compact?: boolean }) {
  const label = `${architectureLabel(installer.architecture)} · ${installer.format}`
  return <Button variant={compact ? "default" : "outline"} size="sm" className={compact ? undefined : "w-full justify-between"} asChild><a href={installer.url}><span>{label}</span>{compact ? <DownloadIcon data-icon="inline-end" /> : <span className="ml-3 text-xs font-normal opacity-60">{formatBytes(installer.size)}</span>}</a></Button>
}

async function detectPlatform(): Promise<DetectedPlatform | null> {
  const nav = navigator as Navigator & { userAgentData?: NavigatorUAData }
  const source = `${nav.userAgentData?.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`
  if (/iphone|ipad|android/i.test(source)) return null
  const platform: DesktopPlatform | null = /windows|win32|win64/i.test(source) ? "windows" : /mac/i.test(source) ? "macos" : /linux|x11/i.test(source) ? "linux" : null
  if (!platform) return null
  let architecture: DesktopArchitecture | undefined
  try {
    const values = await nav.userAgentData?.getHighEntropyValues?.(["architecture", "bitness"])
    if (values?.architecture && /arm/i.test(values.architecture)) architecture = "arm64"
    else if (values?.architecture && /x86/i.test(values.architecture) && values.bitness === "64") architecture = "x64"
  } catch {}
  if (!architecture && /arm64|aarch64/i.test(navigator.userAgent)) architecture = "arm64"
  if (!architecture && platform !== "macos" && /x86_64|x64|win64|amd64/i.test(source)) architecture = "x64"
  return { platform, architecture }
}

function rankInstallers(installers: DesktopInstaller[], architecture?: DesktopArchitecture) {
  const formatRank: Record<DesktopInstaller["format"], number> = { NSIS: 0, DMG: 0, AppImage: 0, MSI: 1, DEB: 1, RPM: 2 }
  return [...installers].sort((a, b) => Number(Boolean(architecture && b.architecture === architecture)) - Number(Boolean(architecture && a.architecture === architecture)) || formatRank[a.format] - formatRank[b.format] || a.name.localeCompare(b.name))
}

function architectureLabel(architecture: DesktopArchitecture) { return architecture === "arm64" ? "ARM64" : architecture === "x64" ? "x64" : "Universal" }
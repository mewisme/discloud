import { Badge } from "@discloud/ui/components/badge"
import { ActivityIcon, BellIcon, BotIcon, CheckIcon, CloudIcon, DownloadIcon, FolderIcon, FolderSyncIcon, Globe2Icon, HardDriveIcon, HeartIcon, HistoryIcon, ImagesIcon, KeyRoundIcon, LibraryIcon, MonitorIcon, SearchIcon, Share2Icon, ShieldCheckIcon, SlidersHorizontalIcon, Trash2Icon, UploadCloudIcon, UsersIcon } from "lucide-react"
import type { Metadata } from "next"

import { DesktopDownloads } from "@/components/features/desktop-downloads"
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome"
import { authenticatedPath, getCurrentUser } from "@/lib/auth/session"
import { getDesktopRelease } from "@/lib/releases/desktop"

export const metadata: Metadata = { title: "Features", description: "Compare DisCloud features across the web and native desktop clients." }

type Capability = { label: string; web?: string; desktop?: string; icon: typeof CloudIcon }
type CapabilityGroup = { title: string; description: string; items: Capability[] }

const FEATURE_GROUPS: CapabilityGroup[] = [
  {
    title: "Files and transfers",
    description: "Core storage workflows are available everywhere; Desktop replaces browser boundaries with native transfer tooling where it matters.",
    items: [
      { label: "Hierarchical files and folders", web: "Available", desktop: "Available", icon: FolderIcon },
      { label: "Resumable chunked uploads", web: "Browser queue", desktop: "Native queue", icon: UploadCloudIcon },
      { label: "Downloads", web: "Browser download", desktop: "Queue + reveal", icon: DownloadIcon },
      { label: "File preview and range streaming", web: "Server media", desktop: "Server media", icon: ImagesIcon },
      { label: "Search, filter and sort", web: "Available", desktop: "Available", icon: SearchIcon },
      { label: "File version history", web: "Available", desktop: "Available", icon: HistoryIcon },
    ],
  },
  {
    title: "Organization and visibility",
    description: "The same workspace model, organization tools and operational views are shared by both clients.",
    items: [
      { label: "Favorites", web: "Available", desktop: "Available", icon: HeartIcon },
      { label: "Collections", web: "Available", desktop: "Available", icon: LibraryIcon },
      { label: "Trash, restore and empty trash", web: "Available", desktop: "Available", icon: Trash2Icon },
      { label: "Recent activity", web: "Available", desktop: "Available", icon: ActivityIcon },
      { label: "Storage analyzer", web: "Available", desktop: "Available", icon: HardDriveIcon },
    ],
  },
  {
    title: "Sharing and security",
    description: "Access control remains server-enforced, so permissions and account security behave consistently on Web and Desktop.",
    items: [
      { label: "Workspace access controls", web: "Available", desktop: "Available", icon: ShieldCheckIcon },
      { label: "Public file, folder and collection shares", web: "Create + manage", desktop: "Create + manage", icon: Share2Icon },
      { label: "Public share viewer", web: "Public route", icon: Globe2Icon },
      { label: "Multi-user workspaces", web: "Available", desktop: "Available", icon: UsersIcon },
      { label: "MFA and security settings", web: "Available", desktop: "Available", icon: KeyRoundIcon },
    ],
  },
  {
    title: "Workspace preferences",
    description: "Common preferences are stored per user and shared between Web and Desktop instead of being reconfigured per client.",
    items: [
      { label: "Theme and custom appearance", web: "Shared config", desktop: "Shared config", icon: MonitorIcon },
      { label: "Sidebar and file browser layout", web: "Shared config", desktop: "Shared config", icon: SlidersHorizontalIcon },
      { label: "Pagination, preview and timezone", web: "Shared config", desktop: "Shared config", icon: SlidersHorizontalIcon },
    ],
  },
  {
    title: "Administration",
    description: "Administrators can operate the same server from either client without losing visibility into storage or runtime state.",
    items: [
      { label: "Users and storage quotas", web: "Available", desktop: "Available", icon: UsersIcon },
      { label: "Discord storage bot pool", web: "Available", desktop: "Available", icon: BotIcon },
      { label: "Runtime diagnostics", web: "Available", desktop: "Available", icon: ActivityIcon },
    ],
  },
  {
    title: "Desktop-native",
    description: "These workflows require direct operating-system access and are intentionally exclusive to the Tauri client.",
    items: [
      { label: "Local folder sync", desktop: "Native", icon: FolderSyncIcon },
      { label: "Sync conflict center", desktop: "Built in", icon: FolderSyncIcon },
      { label: "Local thumbnail generation", desktop: "OS + FFmpeg", icon: ImagesIcon },
      { label: "Native transfer manager", desktop: "Built in", icon: DownloadIcon },
      { label: "System tray and close-to-tray", desktop: "Built in", icon: MonitorIcon },
      { label: "System notifications", desktop: "Native", icon: BellIcon },
      { label: "Signed update channels", desktop: "Stable → Alpha", icon: ShieldCheckIcon },
      { label: "Connect to self-hosted servers", desktop: "Saved session", icon: Globe2Icon },
    ],
  },
]

export default async function FeaturesPage() {
  const [user, release] = await Promise.all([getCurrentUser(), getDesktopRelease()])
  const appHref = user ? authenticatedPath(user) : "/login"
  const appLabel = user ? user.mustChangePassword ? "Continue setup" : "Open workspace" : "Sign in"
  const sharedCount = FEATURE_GROUPS.flatMap((group) => group.items).filter((item) => item.web && item.desktop).length
  const desktopOnlyCount = FEATURE_GROUPS.flatMap((group) => group.items).filter((item) => !item.web && item.desktop).length

  return (
    <main className="min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] overflow-hidden"><div className="absolute top-[-18rem] left-1/2 size-[38rem] -translate-x-1/2 rounded-full bg-foreground/[0.035] blur-3xl" /><div className="absolute inset-0 mask-b-from-10% mask-b-to-95% bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-25" /></div>
      <PublicHeader appHref={appHref} appLabel={appLabel} />

      <section className="mx-auto max-w-7xl px-5 pt-20 pb-16 sm:px-8 sm:pt-28 sm:pb-20">
        <div className="max-w-4xl">
          <Badge variant="secondary">Web + Desktop</Badge>
          <h1 className="mt-5 text-5xl leading-[0.98] font-semibold tracking-[-0.055em] text-balance sm:text-6xl">One server. Two clients. Native when it helps.</h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">Use DisCloud from any browser for the complete workspace experience, then add Desktop when you want folder sync, native transfers and operating-system integration.</p>
          <div className="mt-8 flex flex-wrap gap-2 text-sm"><Badge variant="outline"><Globe2Icon />{sharedCount} cross-client workflows</Badge><Badge variant="outline"><MonitorIcon />{desktopOnlyCount} desktop-native workflows</Badge></div>
        </div>
      </section>

      <DesktopDownloads release={release} />

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="mb-10 max-w-2xl"><p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Capability matrix</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">What runs where.</h2><p className="mt-4 leading-7 text-muted-foreground">The matrix is based on the implemented Web routes, shared UI surfaces, Desktop routes and native Tauri capabilities in this repository.</p></div>
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="hidden grid-cols-[minmax(0,1fr)_12rem_12rem] border-b bg-muted/30 px-5 py-3 text-xs font-medium text-muted-foreground md:grid"><span>Feature</span><span>Web</span><span>Desktop</span></div>
          {FEATURE_GROUPS.map((group) => <FeatureGroup key={group.title} group={group} />)}
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}

function FeatureGroup({ group }: { group: CapabilityGroup }) {
  return (
    <section className="border-b last:border-b-0">
      <div className="border-b bg-muted/15 px-5 py-4"><h3 className="font-medium">{group.title}</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{group.description}</p></div>
      <div>{group.items.map((item) => <FeatureRow key={item.label} item={item} />)}</div>
    </section>
  )
}

function FeatureRow({ item }: { item: Capability }) {
  const Icon = item.icon
  return (
    <div className="grid gap-3 border-b px-5 py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_12rem_12rem] md:items-center">
      <div className="flex min-w-0 items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span><span className="text-sm font-medium">{item.label}</span></div>
      <CapabilityStatus label="Web" value={item.web} />
      <CapabilityStatus label="Desktop" value={item.desktop} />
    </div>
  )
}

function CapabilityStatus({ label, value }: { label: string; value?: string }) {
  return <div className="flex items-center justify-between gap-3 text-xs md:justify-start"><span className="text-muted-foreground md:hidden">{label}</span>{value ? <span className="inline-flex items-center gap-1.5 font-medium"><CheckIcon className="size-3.5" />{value}</span> : <span className="text-muted-foreground">—</span>}</div>
}
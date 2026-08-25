import type { RecentActivityItem } from "@discloud/api/models"
import { workspaceCollectionPath, workspaceFilePath, workspaceFolderPath } from "@discloud/shared/navigation"
import { ArchiveRestoreIcon, FileUpIcon, FolderInputIcon, HistoryIcon, PencilIcon, RefreshCwIcon, Share2Icon, ShieldIcon, Trash2Icon } from "lucide-react"
import type { ComponentType, ReactNode } from "react"

export type ActivityLinkRenderer = (props: { href: string; className?: string; children: ReactNode }) => ReactNode

export function RecentActivityView({ username, items, pagination, renderLink }: { username: string; items: readonly RecentActivityItem[]; pagination?: ReactNode; renderLink: ActivityLinkRenderer }) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Recent activity</h1><p className="text-sm text-muted-foreground">Workspace changes, sharing, sync, and admin events.</p></div>
      {items.length ? <div className="overflow-hidden rounded-xl border bg-card">{items.map((item) => <ActivityRow key={item.id} username={username} item={item} renderLink={renderLink} />)}</div> : <div className="grid min-h-56 place-items-center rounded-xl border border-dashed"><div className="text-center"><HistoryIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="font-medium">No recent activity</p><p className="text-sm text-muted-foreground">Workspace events will appear here.</p></div></div>}
      {pagination}
    </div>
  )
}

function ActivityRow({ username, item, renderLink }: { username: string; item: RecentActivityItem; renderLink: ActivityLinkRenderer }) {
  const Icon = activityIcon(item.kind)
  const target = activityTarget(username, item)
  const actor = activityActor(item)
  const targetName = item.target.name || "workspace"
  const targetType = activityTargetType(item)
  const time = formatTime(item.createdAt)
  return (
    <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 border-b px-3 py-2.5 last:border-b-0 sm:grid-cols-[2rem_7rem_minmax(0,1fr)_9rem] sm:px-4">
      <div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></div>
      <span className="hidden text-xs font-medium text-muted-foreground sm:block">{activityLabel(item.action)}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0 font-medium text-muted-foreground sm:hidden">{activityLabel(item.action)}</span>
          {target ? renderLink({ href: target, className: "min-w-0 truncate font-medium hover:underline", children: <span className="block truncate" title={targetName}>{targetName}</span> }) : <span className="min-w-0 truncate font-medium" title={targetName}>{targetName}</span>}
          {item.adminOnly ? <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Admin</span> : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="max-w-32 truncate sm:max-w-48" title={actor.title}>{actor.label}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 capitalize">{targetType}</span>
          {item.detail ? <><span aria-hidden="true">·</span><span className="min-w-0 truncate" title={item.detail}>{item.detail}</span></> : null}
          <time className="ml-auto shrink-0 tabular-nums sm:hidden" dateTime={item.createdAt} title={time.full}>{time.compact}</time>
        </div>
      </div>
      <time className="hidden whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground sm:block" dateTime={item.createdAt} title={time.full}>{time.compact}</time>
    </div>
  )
}

function activityIcon(kind: RecentActivityItem["kind"]): ComponentType<{ className?: string }> {
  if (kind === "upload") return FileUpIcon
  if (kind === "rename") return PencilIcon
  if (kind === "move") return FolderInputIcon
  if (kind === "trash") return Trash2Icon
  if (kind === "restore") return ArchiveRestoreIcon
  if (kind === "share") return Share2Icon
  if (kind === "sync") return RefreshCwIcon
  return ShieldIcon
}

function activityLabel(action: RecentActivityItem["action"]) {
  const labels: Record<RecentActivityItem["action"], string> = {
    "file.create": "Uploaded", "file.version.create": "New version", "node.rename": "Renamed", "node.move": "Moved", "node.trash": "Trashed", "node.restore": "Restored", "share.create": "Shared", "share.update": "Share updated", "share.revoke": "Share revoked", "sync.run": "Synced", "user.create": "User created", "user.update": "User updated", "user.quota_update": "Quota updated", "user.password_reset": "Password reset", "user.active": "User enabled", "user.disabled": "User disabled",
  }
  return labels[action]
}

function activityActor(item: RecentActivityItem) {
  const label = item.actor.name || (item.actor.username ? `@${item.actor.username}` : "System")
  const title = item.actor.name && item.actor.username ? `${item.actor.name} · @${item.actor.username}` : label
  return { label, title }
}

function activityTargetType(item: RecentActivityItem) {
  if (item.kind === "sync") return "sync"
  if (item.target.type === "file" || item.target.type === "folder" || item.target.type === "collection" || item.target.type === "user") return item.target.type
  return "workspace"
}

function activityTarget(username: string, item: RecentActivityItem) {
  if (item.action === "node.trash" || !item.target.id) return undefined
  if (item.target.type === "file") return workspaceFilePath(username, item.target.id)
  if (item.target.type === "folder") return workspaceFolderPath(username, item.target.id)
  if (item.target.type === "collection") return workspaceCollectionPath(username, item.target.id)
  return undefined
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { compact: value, full: value }
  return {
    compact: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date).replace(",", " ·"),
    full: new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "medium" }).format(date),
  }
}

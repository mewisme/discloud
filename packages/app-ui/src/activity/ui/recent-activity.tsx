import type { RecentActivityItem } from "@discloud/api/models"
import { workspaceCollectionPath, workspaceFilePath, workspaceFolderPath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { ArchiveRestoreIcon, FileUpIcon, FolderInputIcon, HistoryIcon, Loader2Icon, PencilIcon, RefreshCwIcon, Share2Icon, ShieldIcon, Trash2Icon } from "lucide-react"
import type { ComponentType, ReactNode } from "react"

export type ActivityLinkRenderer = (props: { href: string; className?: string; children: ReactNode }) => ReactNode

export function RecentActivityView({ username, items, hasMore, loadingMore, onLoadMore, renderLink }: { username: string; items: readonly RecentActivityItem[]; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; renderLink: ActivityLinkRenderer }) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div><h1 className="text-xl font-semibold">Recent activity</h1><p className="text-sm text-muted-foreground">Uploads, file changes, sharing, sync and administrative activity for this workspace.</p></div>
      {items.length ? <div className="overflow-hidden rounded-xl border bg-card">{items.map((item) => <ActivityRow key={item.id} username={username} item={item} renderLink={renderLink} />)}</div> : <div className="grid min-h-56 place-items-center rounded-xl border border-dashed"><div className="text-center"><HistoryIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="font-medium">No recent activity</p><p className="text-sm text-muted-foreground">New workspace actions will appear here.</p></div></div>}
      {hasMore ? <div className="flex justify-center"><Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}Load more</Button></div> : null}
    </div>
  )
}

function ActivityRow({ username, item, renderLink }: { username: string; item: RecentActivityItem; renderLink: ActivityLinkRenderer }) {
  const Icon = activityIcon(item.kind)
  const target = activityTarget(username, item)
  const actor = item.actor.name || item.actor.username || "System"
  const targetName = item.target.name || "workspace"
  return (
    <div className="flex gap-3 border-b p-4 last:border-b-0">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <div className="min-w-0 text-sm"><span className="font-medium">{actor}</span>{" "}{activityVerb(item.action)}{" "}{target ? renderLink({ href: target, className: "break-words font-medium hover:underline", children: targetName }) : <span className="break-words font-medium">{targetName}</span>}{item.adminOnly ? <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Admin</span> : null}</div>
        {item.detail ? <p className="mt-1 break-words text-xs text-muted-foreground">{item.detail}</p> : null}
        <time className="mt-1 block text-xs text-muted-foreground" dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
      </div>
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

function activityVerb(action: RecentActivityItem["action"]) {
  const verbs: Record<RecentActivityItem["action"], string> = {
    "file.create": "uploaded", "file.version.create": "uploaded a new version of", "node.rename": "renamed", "node.move": "moved", "node.trash": "moved to Trash", "node.restore": "restored", "share.create": "shared", "share.update": "updated sharing for", "share.revoke": "revoked sharing for", "sync.run": "synced", "user.create": "created", "user.update": "updated", "user.quota_update": "updated storage quota for", "user.password_reset": "reset the password for", "user.active": "enabled", "user.disabled": "disabled",
  }
  return verbs[action]
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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

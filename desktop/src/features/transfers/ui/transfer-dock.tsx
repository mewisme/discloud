import { BottomDock } from "@discloud/app-ui/shell/dock-stack"
import { formatBytes } from "@discloud/shared/format"
import { workspacePath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { Progress } from "@discloud/ui/components/progress"
import { CircleAlertIcon, DownloadIcon, Loader2Icon, RefreshCwIcon, UploadIcon } from "lucide-react"
import { Link } from "react-router"

import { type DownloadTask,downloadTaskPercent, isActiveDownloadTask } from "../../downloads/core/download-store"
import { downloadTaskActivityLabel, downloadTaskChunkLabel, formatDownloadEta } from "../../downloads/core/download-task"
import { useDownloadTasks } from "../../downloads/ui/download-provider"
import { useDesktopSync } from "../../sync/ui/sync-provider"
import { nativeUploadThumbnailURL } from "../../uploads/core/native"
import { isActiveUploadTask, uploadTaskPercent } from "../../uploads/core/upload-task"
import { useUploadTasks } from "../../uploads/ui/upload-provider"

export function DesktopTransferDock({ username }: { username: string }) {
  const downloads = useDownloadTasks()
  const uploads = useUploadTasks()
  const sync = useDesktopSync()
  const activeDownload = downloads.find(isActiveDownloadTask)
  const activeUpload = uploads.find(isActiveUploadTask)
  const failedDownload = downloads.find((task) => task.status === "error")
  const failedUpload = uploads.find((task) => task.status === "error")
  const syncingPair = sync.pairs.find((pair) => sync.runtimes[pair.id]?.status === "syncing")
  const failedSyncPair = sync.pairs.find((pair) => sync.runtimes[pair.id]?.status === "error")
  const activeCount = downloads.filter(isActiveDownloadTask).length + uploads.filter(isActiveUploadTask).length + sync.pairs.filter((pair) => sync.runtimes[pair.id]?.status === "syncing").length
  const failedCount = downloads.filter((task) => task.status === "error").length + uploads.filter((task) => task.status === "error").length + sync.pairs.filter((pair) => sync.runtimes[pair.id]?.status === "error").length

  if (!activeCount && !failedCount) return null

  const focus = activeDownload
    ? { kind: "download" as const, title: downloadTaskActivityLabel(activeDownload), name: activeDownload.fileName, progress: downloadTaskPercent(activeDownload), detail: downloadDetail(activeDownload) }
    : activeUpload
      ? { kind: "upload" as const, title: "Uploading", name: activeUpload.file.name, progress: uploadTaskPercent(activeUpload), detail: `${formatBytes(activeUpload.uploadedBytes)} / ${formatBytes(activeUpload.file.size)}` }
      : syncingPair
        ? { kind: "sync" as const, title: "Syncing", name: syncingPair.remoteFolderName, progress: undefined, detail: undefined }
        : failedDownload
          ? { kind: "download" as const, title: "Download failed", name: failedDownload.fileName, progress: downloadTaskPercent(failedDownload), detail: failedDownload.error }
          : failedUpload
            ? { kind: "upload" as const, title: "Upload failed", name: failedUpload.file.name, progress: uploadTaskPercent(failedUpload), detail: failedUpload.error }
            : { kind: "sync" as const, title: "Sync failed", name: failedSyncPair?.remoteFolderName ?? "Folder sync", progress: undefined, detail: failedSyncPair ? sync.runtimes[failedSyncPair.id]?.error : undefined }
  const focusedUpload = focus.kind === "upload" ? activeUpload ?? failedUpload : undefined
  const focusThumbnail = focusedUpload?.thumbnailKey ? nativeUploadThumbnailURL(focusedUpload.thumbnailKey) : undefined

  return (
    <BottomDock slot="uploads">
      <div className="flex min-w-0 max-w-full items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md">
        <div className={`grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg ${failedCount > 0 && activeCount === 0 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
          {focusThumbnail ? <img src={focusThumbnail} alt="" draggable={false} className="size-full object-cover" /> : failedCount > 0 && activeCount === 0 ? <CircleAlertIcon className="size-4" /> : <Loader2Icon className="size-4 animate-spin" />}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-sm font-medium">{focus.title}</span>
          <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:block">{focus.name}</span>
        </div>

        {focus.progress !== undefined ? <><div className="hidden h-5 w-px bg-border md:block" /><Progress value={focus.progress} className="h-1.5 w-20 shrink-0 lg:w-28" /><span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Math.round(focus.progress)}%</span></> : null}
        {focus.detail ? <span className="hidden max-w-56 truncate text-xs tabular-nums text-muted-foreground xl:block">{focus.detail}</span> : null}
        {activeCount > 1 ? <span className="hidden shrink-0 text-xs text-muted-foreground xl:block">{activeCount} active</span> : null}
        {failedCount > 0 ? <span className="hidden shrink-0 text-xs font-medium text-destructive lg:inline">{failedCount} failed</span> : null}

        <div className="h-5 w-px bg-border" />
        <Button asChild size="icon-sm" variant={focus.kind === "upload" ? "secondary" : "ghost"} title="Uploads" aria-label="Open uploads"><Link to={workspacePath(username, "uploads")}><UploadIcon /></Link></Button>
        <Button asChild size="icon-sm" variant={focus.kind === "download" ? "secondary" : "ghost"} title="Downloads" aria-label="Open downloads"><Link to={workspacePath(username, "downloads")}><DownloadIcon /></Link></Button>
        {sync.pairs.length ? <Button asChild size="icon-sm" variant={focus.kind === "sync" ? "secondary" : "ghost"} title="Sync" aria-label="Open sync"><Link to={workspacePath(username, "sync")}><RefreshCwIcon /></Link></Button> : null}
      </div>
    </BottomDock>
  )
}

function downloadDetail(task: DownloadTask) {
  const parts = [task.totalBytes !== undefined ? `${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}` : formatBytes(task.downloadedBytes)]
  const chunks = downloadTaskChunkLabel(task)
  if (chunks) parts.push(chunks)
  if (task.bytesPerSecond) parts.push(`${formatBytes(task.bytesPerSecond)}/s`)
  if (task.etaSeconds !== undefined) parts.push(`${formatDownloadEta(task.etaSeconds)} left`)
  return parts.join(" · ")
}

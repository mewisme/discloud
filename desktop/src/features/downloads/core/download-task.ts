import type { DownloadTask } from "./download-store"

export function downloadTaskStatusLabel(task: DownloadTask) {
  switch (task.status) {
    case "queued": return "Queued"
    case "downloading": return "Downloading"
    case "completed": return "Complete"
    case "cancelling": return "Cancelling"
    case "cancelled": return "Cancelled"
    default: return "Failed"
  }
}

export function downloadTaskPhaseLabel(task: DownloadTask) {
  if (task.status !== "downloading" || !task.phase) return undefined
  switch (task.phase) {
    case "preparing": return "Preparing"
    case "resuming": return "Checking resume data"
    case "resolving": return "Resolving download links"
    case "transferring": return "Downloading chunks"
    case "verifying": return "Verifying file"
    case "finalizing": return "Finalizing file"
  }
}

export function downloadTaskActivityLabel(task: DownloadTask) {
  return downloadTaskPhaseLabel(task) ?? downloadTaskStatusLabel(task)
}

export function downloadTaskChunkLabel(task: DownloadTask) {
  if (task.completedChunks === undefined || task.totalChunks === undefined || task.totalChunks === 0) return undefined
  return Math.min(task.completedChunks, task.totalChunks) + " / " + task.totalChunks + " chunks"
}

export function formatDownloadEta(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  if (minutes < 60) return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

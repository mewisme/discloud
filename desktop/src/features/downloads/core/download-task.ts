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

export function formatDownloadEta(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  if (minutes < 60) return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

import type { UploadTask } from "@/components/uploads/upload-provider"

export function isActiveUploadTask(task: UploadTask) {
  return ["queued", "preparing", "uploading", "finalizing", "cancelling"].includes(task.status)
}

export function canCancelUploadTask(task: UploadTask) {
  return task.status === "queued"
    || !!task.sessionId && ["preparing", "uploading", "error"].includes(task.status)
}

export function canRemoveUploadTask(task: UploadTask) {
  return task.status === "completed"
    || task.status === "skipped"
    || task.status === "cancelled"
    || task.status === "error" && !task.sessionId
}

export function uploadTaskStatusLabel(task: UploadTask) {
  switch (task.status) {
    case "queued": return "Queued"
    case "preparing": return "Preparing"
    case "uploading": return "Uploading"
    case "finalizing": return "Finalizing"
    case "completed": return "Complete"
    case "cancelling": return "Cancelling"
    case "cancelled": return "Cancelled"
    case "skipped": return "Skipped"
    default: return "Failed"
  }
}

export function uploadTaskPercent(task: UploadTask) {
  if (task.file.size === 0) return task.status === "completed" ? 100 : 0
  return Math.min(100, task.uploadedBytes / task.file.size * 100)
}
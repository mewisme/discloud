"use client"

import { CircleCheckIcon, Loader2Icon, RefreshCwIcon, UploadIcon, XIcon } from "lucide-react"
import { useUploads, type UploadTask } from "@/components/uploads/upload-provider"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { formatBytes } from "@/lib/helpers"

export function UploadManager() {
  const { tasks, retry, cancel, remove } = useUploads()
  if (!tasks.length) return null

  const active = tasks.filter((task) => !["completed", "cancelled", "error"].includes(task.status)).length

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="fixed bottom-4 right-4 z-40 shadow-lg">
          {active > 0 ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          Uploads{active > 0 ? ` (${active})` : ""}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Uploads</SheetTitle>
          <SheetDescription>Uploads continue while you navigate around DisCloud.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {[...tasks].reverse().map((task) => (
            <UploadItem key={task.id} task={task} onRetry={retry} onCancel={cancel} onRemove={remove} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function UploadItem({
  task,
  onRetry,
  onCancel,
  onRemove,
}: {
  task: UploadTask
  onRetry: (id: string) => void
  onCancel: (id: string) => Promise<void>
  onRemove: (id: string) => void
}) {
  const percent = task.file.size === 0
    ? task.status === "completed" ? 100 : 0
    : Math.min(100, task.uploadedBytes / task.file.size * 100)
  const canCancel = task.status === "queued" || !!task.sessionId && ["preparing", "uploading", "error"].includes(task.status)
  const canRemove = task.status === "completed" || task.status === "cancelled" || task.status === "error" && !task.sessionId

  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
          {task.status === "completed" ? <CircleCheckIcon className="size-4" /> : ["queued", "preparing", "uploading", "finalizing", "cancelling"].includes(task.status) ? <Loader2Icon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.file.name}</p>
          <p className="text-xs text-muted-foreground">{statusLabel(task)} · {formatBytes(task.uploadedBytes)} / {formatBytes(task.file.size)}</p>
        </div>
      </div>

      <Progress value={percent} />

      {task.error && <p className="wrap-break-word text-xs text-destructive">{task.error}</p>}

      {(task.status === "error" || canCancel || canRemove) && (
        <div className="flex justify-end gap-2">
          {task.status === "error" && (
            <Button size="sm" variant="outline" onClick={() => onRetry(task.id)}>
              <RefreshCwIcon />
              Retry
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="outline" disabled={task.status === "cancelling"} onClick={() => void onCancel(task.id)}>
              <XIcon />
              Cancel
            </Button>
          )}
          {canRemove && (
            <Button size="sm" variant="ghost" onClick={() => onRemove(task.id)}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function statusLabel(task: UploadTask) {
  switch (task.status) {
    case "queued":
      return "Queued"
    case "preparing":
      return "Preparing"
    case "uploading":
      return "Uploading"
    case "finalizing":
      return "Finalizing"
    case "completed":
      return "Complete"
    case "cancelling":
      return "Cancelling"
    case "cancelled":
      return "Cancelled"
    default:
      return "Failed"
  }
}
import { formatBytes } from "@discloud/shared/format"
import { Button } from "@discloud/ui/components/button"
import { Progress } from "@discloud/ui/components/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { CircleCheckIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"

import type { UploadTask } from "../core/upload-store"
import { canCancelUploadTask, canRemoveUploadTask, isActiveUploadTask, uploadTaskPercent, uploadTaskStatusLabel } from "../core/upload-task"
import { useUploads } from "./upload-provider"

export function DesktopUploadsPage() {
  const { tasks, retry, cancel, remove } = useUploads()
  const active = tasks.filter(isActiveUploadTask)
  const failed = tasks.filter((task) => task.status === "error")
  const completed = tasks.filter((task) => task.status === "completed")
  const cancellable = tasks.filter(canCancelUploadTask)

  async function cancelMany(targets: readonly UploadTask[]) {
    await Promise.all(targets.map((task) => cancel(task.id)))
  }

  function retryMany(targets: readonly UploadTask[]) {
    targets.forEach((task) => retry(task.id))
  }

  function clearCompleted() {
    completed.forEach((task) => remove(task.id))
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Uploads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor native uploads, retry failures, cancel transfers, and review progress.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <UploadMetric label="Active" value={active.length} />
        <UploadMetric label="Failed" value={failed.length} />
        <UploadMetric label="Complete" value={completed.length} />
        <UploadMetric label="Total" value={tasks.length} />
      </div>

      {!tasks.length ? (
        <div className="grid min-h-80 place-items-center rounded-xl border border-dashed p-8 text-center">
          <div className="space-y-3">
            <UploadIcon className="mx-auto size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No uploads yet</p>
              <p className="text-sm text-muted-foreground">
                Upload files, folders, or drop items into the Files view.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="flex flex-wrap gap-2 border-b p-3">
            <Button size="sm" variant="outline" disabled={!failed.length} onClick={() => retryMany(failed)}>
              <RefreshCwIcon />
              Retry all failed
            </Button>

            <Button size="sm" variant="outline" disabled={!cancellable.length} onClick={() => void cancelMany(cancellable)}>
              <XIcon />
              Cancel all
            </Button>

            <Button size="sm" variant="ghost" disabled={!completed.length} onClick={clearCompleted}>
              <Trash2Icon />
              Clear completed
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">Status</TableHead>
                  <TableHead className="hidden w-64 md:table-cell">Progress</TableHead>
                  <TableHead className="hidden w-32 lg:table-cell">Size</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {[...tasks].reverse().map((task) => (
                  <UploadRow key={task.id} task={task} onRetry={retry} onCancel={cancel} onRemove={remove} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

function UploadRow({ task, onRetry, onCancel, onRemove }: {
  task: UploadTask
  onRetry: (id: string) => void
  onCancel: (id: string) => Promise<void>
  onRemove: (id: string) => void
}) {
  const percent = uploadTaskPercent(task)
  const canCancel = canCancelUploadTask(task)
  const canRemove = canRemoveUploadTask(task)

  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {task.status === "completed"
              ? <CircleCheckIcon className="size-4 shrink-0" />
              : isActiveUploadTask(task)
                ? <Loader2Icon className="size-4 shrink-0 animate-spin" />
                : <UploadIcon className="size-4 shrink-0" />}

            <span className="truncate font-medium">{task.file.name}</span>
          </div>

          {task.relativePath && task.relativePath !== task.file.name ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {task.relativePath}
            </p>
          ) : null}

          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
            {uploadTaskStatusLabel(task)} · {formatBytes(task.uploadedBytes)} / {formatBytes(task.file.size)}
          </p>

          {task.error ? (
            <p role="alert" className="mt-1 wrap-break-word text-xs text-destructive">{task.error}</p>
          ) : null}
        </div>
      </TableCell>

      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {uploadTaskStatusLabel(task)}
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <div className="space-y-1">
          <Progress value={percent} className="h-1.5" />
          <div className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
            <span>{formatBytes(task.uploadedBytes)} / {formatBytes(task.file.size)}</span>
            <span>{Math.round(percent)}%</span>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden tabular-nums text-muted-foreground lg:table-cell">
        {formatBytes(task.file.size)}
      </TableCell>

      <TableCell>
        <div className="flex justify-end gap-1">
          {task.status === "error" ? (
            <Button size="icon-sm" variant="ghost" aria-label={`Retry ${task.file.name}`} title="Retry" onClick={() => onRetry(task.id)}>
              <RefreshCwIcon />
            </Button>
          ) : null}

          {canCancel ? (
            <Button size="icon-sm" variant="ghost" disabled={task.status === "cancelling"} aria-label={`Cancel ${task.file.name}`} title="Cancel" onClick={() => void onCancel(task.id)}>
              <XIcon />
            </Button>
          ) : null}

          {canRemove ? (
            <Button size="icon-sm" variant="ghost" aria-label={`Dismiss ${task.file.name}`} title="Dismiss" onClick={() => onRemove(task.id)}>
              <Trash2Icon />
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function UploadMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
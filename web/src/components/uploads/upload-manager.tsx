"use client"

import { CircleCheckIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { useWorkspace } from "@/components/app/workspace-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type UploadTask, useUploads } from "@/components/uploads/upload-provider"
import { formatBytes } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

export function UploadManager() {
  const pathname = usePathname()
  const workspace = useWorkspace()
  const { tasks } = useUploads()

  if (!tasks.length) return null

  const href = workspacePath(workspace.username, "uploads")
  if (pathname === href || pathname === `${href}/`) return null

  const active = tasks.filter(isActive).length
  const failed = tasks.filter((task) => task.status === "error").length

  return (
    <Button asChild className="fixed bottom-4 right-4 z-40 shadow-lg">
      <Link href={href}>
        {active > 0 ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        Uploads
        {(active > 0 || failed > 0) && (
          <span className="text-xs opacity-80">
            ({active} active{failed > 0 ? ` · ${failed} failed` : ""})
          </span>
        )}
      </Link>
    </Button>
  )
}

export function UploadManagerPage() {
  const { tasks, retry, cancel, remove } = useUploads()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const active = tasks.filter(isActive).length
  const failed = tasks.filter((task) => task.status === "error")
  const completed = tasks.filter((task) => task.status === "completed")
  const cancellable = tasks.filter(canCancelTask)
  const selectedTasks = tasks.filter((task) => selected.has(task.id))
  const selectedCancellable = selectedTasks.filter(canCancelTask)
  const selectedFailed = selectedTasks.filter((task) => task.status === "error")
  const allSelected = tasks.length > 0 && tasks.every((task) => selected.has(task.id))
  const someSelected = tasks.some((task) => selected.has(task.id))

  function select(taskId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }

  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(tasks.map((task) => task.id)) : new Set())
  }

  function clearSelection(ids: readonly string[]) {
    setSelected((current) => {
      const next = new Set(current)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }

  function retryMany(targets: readonly UploadTask[]) {
    targets.forEach((task) => retry(task.id))
    clearSelection(targets.map((task) => task.id))
  }

  async function cancelMany(targets: readonly UploadTask[]) {
    await Promise.all(targets.map((task) => cancel(task.id)))
    clearSelection(targets.map((task) => task.id))
  }

  function clearCompleted() {
    completed.forEach((task) => remove(task.id))
    clearSelection(completed.map((task) => task.id))
  }

  function removeTask(taskId: string) {
    remove(taskId)
    clearSelection([taskId])
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Uploads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor uploads, retry failures, cancel active transfers, and review progress.
          Uploads continue while you navigate around DisCloud.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <UploadMetric label="Active" value={active} />
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
                Start an upload from Files and its progress will appear here.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="flex flex-wrap gap-2 border-b p-3">
            <Button size="sm" variant="outline" disabled={!selectedCancellable.length} onClick={() => void cancelMany(selectedCancellable)}>
              <XIcon />
              Cancel selected
            </Button>

            <Button size="sm" variant="outline" disabled={!selectedFailed.length} onClick={() => retryMany(selectedFailed)}>
              <RefreshCwIcon />
              Retry selected
            </Button>

            <Button size="sm" variant="ghost" disabled={!failed.length} onClick={() => retryMany(failed)}>
              Retry all failed
            </Button>

            <Button size="sm" variant="ghost" disabled={!cancellable.length} onClick={() => void cancelMany(cancellable)}>
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
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      aria-label="Select all uploads"
                      onCheckedChange={(value) => selectAll(value === true)}
                    />
                  </TableHead>
                  <TableHead>File</TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">Status</TableHead>
                  <TableHead className="hidden w-56 md:table-cell">Progress</TableHead>
                  <TableHead className="hidden w-32 lg:table-cell">Size</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {[...tasks].reverse().map((task) => (
                  <UploadRow
                    key={task.id}
                    task={task}
                    selected={selected.has(task.id)}
                    onSelect={select}
                    onRetry={retry}
                    onCancel={cancel}
                    onRemove={removeTask}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
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

function UploadRow({
  task,
  selected,
  onSelect,
  onRetry,
  onCancel,
  onRemove,
}: {
  task: UploadTask
  selected: boolean
  onSelect: (id: string, checked: boolean) => void
  onRetry: (id: string) => void
  onCancel: (id: string) => Promise<void>
  onRemove: (id: string) => void
}) {
  const percent = task.file.size === 0
    ? task.status === "completed" ? 100 : 0
    : Math.min(100, task.uploadedBytes / task.file.size * 100)
  const canCancel = canCancelTask(task)
  const canRemove = canRemoveTask(task)

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox checked={selected} aria-label={`Select ${task.file.name}`} onCheckedChange={(value) => onSelect(task.id, value === true)} />
      </TableCell>

      <TableCell>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {task.status === "completed"
              ? <CircleCheckIcon className="size-4 shrink-0" />
              : isActive(task)
                ? <Loader2Icon className="size-4 shrink-0 animate-spin" />
                : <UploadIcon className="size-4 shrink-0" />}

            <span className="truncate font-medium">{task.file.name}</span>
          </div>

          {task.relativePath && task.relativePath !== task.file.name && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.relativePath}</p>
          )}

          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
            {statusLabel(task)} · {formatBytes(task.uploadedBytes)} / {formatBytes(task.file.size)}
          </p>

          {task.error && (
            <p role="alert" className="mt-1 wrap-break-word text-xs text-destructive">
              {task.error}
            </p>
          )}
        </div>
      </TableCell>

      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {statusLabel(task)}
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
          {task.status === "error" && (
            <Button size="icon-sm" variant="ghost" aria-label={`Retry ${task.file.name}`} title="Retry" onClick={() => onRetry(task.id)}>
              <RefreshCwIcon />
            </Button>
          )}

          {canCancel && (
            <Button size="icon-sm" variant="ghost" disabled={task.status === "cancelling"} aria-label={`Cancel ${task.file.name}`} title="Cancel" onClick={() => void onCancel(task.id)}>
              <XIcon />
            </Button>
          )}

          {canRemove && (
            <Button size="icon-sm" variant="ghost" aria-label={`Dismiss ${task.file.name}`} title="Dismiss" onClick={() => onRemove(task.id)}>
              <Trash2Icon />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function isActive(task: UploadTask) {
  return ["queued", "preparing", "uploading", "finalizing", "cancelling"].includes(task.status)
}

function canCancelTask(task: UploadTask) {
  return task.status === "queued" || !!task.sessionId && ["preparing", "uploading", "error"].includes(task.status)
}

function canRemoveTask(task: UploadTask) {
  return task.status === "completed"
    || task.status === "skipped"
    || task.status === "cancelled"
    || task.status === "error" && !task.sessionId
}

function statusLabel(task: UploadTask) {
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
"use client"

import { CircleCheckIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type UploadTask, useUploads } from "@/components/uploads/upload-provider"
import { formatBytes } from "@/lib/helpers"

export function UploadManager() {
  const { tasks, retry, cancel, remove } = useUploads()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  if (!tasks.length) return null

  const active = tasks.filter(isActive).length
  const skipped = tasks.filter((task) => task.status === "skipped")
  const finished = tasks.filter((task) => task.status === "completed" || task.status === "skipped")
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
    <Sheet>
      <SheetTrigger asChild>
        <Button className="fixed bottom-4 right-4 z-40 shadow-lg">
          {active > 0 ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          Uploads
          {(active > 0 || failed.length > 0) && (
            <span className="text-xs opacity-80">
              ({active} active{failed.length > 0 ? ` · ${failed.length} failed` : ""})
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle>Uploads ({active} active · {failed.length} failed)</SheetTitle>
          <SheetDescription>Uploads continue while you navigate around DisCloud.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap gap-2 border-b px-4 py-3">
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    aria-label="Select all uploads"
                    onCheckedChange={(value) => selectAll(value === true)}
                  />
                </TableHead>
                <TableHead>File</TableHead>
                <TableHead className="hidden w-28 sm:table-cell">Status</TableHead>
                <TableHead className="hidden w-44 md:table-cell">Progress</TableHead>
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
      </SheetContent>
    </Sheet>
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
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatBytes(task.uploadedBytes)} / {formatBytes(task.file.size)}
            <span className="sm:hidden"> · {statusLabel(task)}</span>
          </p>
          {task.error && <p role="alert" className="mt-1 wrap-break-word text-xs text-destructive">{task.error}</p>}
        </div>
      </TableCell>

      <TableCell className="hidden text-muted-foreground sm:table-cell">{statusLabel(task)}</TableCell>

      <TableCell className="hidden md:table-cell">
        <div className="space-y-1">
          <Progress value={percent} className="h-1.5" />
          <p className="text-right text-xs tabular-nums text-muted-foreground">{Math.round(percent)}%</p>
        </div>
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
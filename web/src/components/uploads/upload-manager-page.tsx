"use client"

import { RefreshCwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { type UploadTask, useUploads } from "@/components/uploads/upload-provider"
import { UploadTable } from "@/components/uploads/upload-table"
import { canCancelUploadTask, isActiveUploadTask } from "@/components/uploads/upload-task"

export function UploadManagerPage() {
  const { tasks, retry, cancel, remove } = useUploads()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const active = tasks.filter(isActiveUploadTask).length
  const failed = tasks.filter((task) => task.status === "error")
  const completed = tasks.filter((task) => task.status === "completed")
  const cancellable = tasks.filter(canCancelUploadTask)
  const selectedTasks = tasks.filter((task) => selected.has(task.id))
  const selectedCancellable = selectedTasks.filter(canCancelUploadTask)
  const selectedFailed = selectedTasks.filter((task) => task.status === "error")

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
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedCancellable.length}
              onClick={() => void cancelMany(selectedCancellable)}
            >
              <XIcon />
              Cancel selected
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={!selectedFailed.length}
              onClick={() => retryMany(selectedFailed)}
            >
              <RefreshCwIcon />
              Retry selected
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={!failed.length}
              onClick={() => retryMany(failed)}
            >
              Retry all failed
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={!cancellable.length}
              onClick={() => void cancelMany(cancellable)}
            >
              Cancel all
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={!completed.length}
              onClick={clearCompleted}
            >
              <Trash2Icon />
              Clear completed
            </Button>
          </div>

          <UploadTable
            tasks={tasks}
            selected={selected}
            onSelect={select}
            onSelectAll={selectAll}
            onRetry={retry}
            onCancel={cancel}
            onRemove={removeTask}
          />
        </div>
      )}
    </div>
  )
}

function UploadMetric({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
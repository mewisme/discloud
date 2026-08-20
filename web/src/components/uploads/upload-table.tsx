"use client"

import { CircleCheckIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { UploadTask } from "@/components/uploads/upload-provider"
import { canCancelUploadTask, canRemoveUploadTask, isActiveUploadTask, uploadTaskPercent, uploadTaskStatusLabel } from "@/components/uploads/upload-task"
import { formatBytes } from "@/lib/helpers"

export function UploadTable({
  tasks,
  selected,
  onSelect,
  onSelectAll,
  onRetry,
  onCancel,
  onRemove,
}: {
  tasks: readonly UploadTask[]
  selected: ReadonlySet<string>
  onSelect: (id: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onRetry: (id: string) => void
  onCancel: (id: string) => Promise<void>
  onRemove: (id: string) => void
}) {
  const allSelected = tasks.length > 0 && tasks.every((task) => selected.has(task.id))
  const someSelected = tasks.some((task) => selected.has(task.id))

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                aria-label="Select all uploads"
                onCheckedChange={(value) => onSelectAll(value === true)}
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
              onSelect={onSelect}
              onRetry={onRetry}
              onCancel={onCancel}
              onRemove={onRemove}
            />
          ))}
        </TableBody>
      </Table>
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
  const percent = uploadTaskPercent(task)
  const canCancel = canCancelUploadTask(task)
  const canRemove = canRemoveUploadTask(task)

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          aria-label={`Select ${task.file.name}`}
          onCheckedChange={(value) => onSelect(task.id, value === true)}
        />
      </TableCell>

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

          {task.relativePath && task.relativePath !== task.file.name && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {task.relativePath}
            </p>
          )}

          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
            {uploadTaskStatusLabel(task)} · {formatBytes(task.uploadedBytes)} / {formatBytes(task.file.size)}
          </p>

          {task.error && (
            <p role="alert" className="mt-1 wrap-break-word text-xs text-destructive">
              {task.error}
            </p>
          )}
        </div>
      </TableCell>

      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {uploadTaskStatusLabel(task)}
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <div className="space-y-1">
          <Progress value={percent} className="h-1.5" />

          <div className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
            <span>
              {formatBytes(task.uploadedBytes)} / {formatBytes(task.file.size)}
            </span>
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
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Retry ${task.file.name}`}
              title="Retry"
              onClick={() => onRetry(task.id)}
            >
              <RefreshCwIcon />
            </Button>
          )}

          {canCancel && (
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={task.status === "cancelling"}
              aria-label={`Cancel ${task.file.name}`}
              title="Cancel"
              onClick={() => void onCancel(task.id)}
            >
              <XIcon />
            </Button>
          )}

          {canRemove && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Dismiss ${task.file.name}`}
              title="Dismiss"
              onClick={() => onRemove(task.id)}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
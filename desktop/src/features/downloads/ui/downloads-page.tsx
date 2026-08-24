import { formatBytes } from "@discloud/shared/format"
import { Button } from "@discloud/ui/components/button"
import { Progress } from "@discloud/ui/components/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { CircleCheckIcon, DownloadIcon, FolderOpenIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react"
import { useState } from "react"

import { errorMessage } from "#lib/instance"

import { type DownloadTask,downloadTaskPercent, isActiveDownloadTask } from "../core/download-store"
import { downloadTaskStatusLabel, formatDownloadEta } from "../core/download-task"
import { useDownloads } from "./download-provider"

export function DesktopDownloadsPage() {
  const { tasks, retry, cancel, remove, reveal } = useDownloads()
  const [actionError, setActionError] = useState<string>()
  const active = tasks.filter(isActiveDownloadTask)
  const failed = tasks.filter((task) => task.status === "error")
  const completed = tasks.filter((task) => task.status === "completed")
  const cancellable = tasks.filter((task) => task.canCancel)
  const clearable = tasks.filter((task) => task.canRemove && task.status !== "error")

  async function perform(action: () => Promise<unknown>) {
    setActionError(undefined)
    try {
      await action()
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  async function cancelMany(targets: readonly DownloadTask[]) {
    for (const task of targets) await perform(() => cancel(task.id))
  }

  async function retryMany(targets: readonly DownloadTask[]) {
    for (const task of targets) await perform(() => retry(task.id))
  }

  async function clearFinished() {
    for (const task of clearable) await perform(() => remove(task.id))
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Downloads</h1>
        <p className="mt-1 text-sm text-muted-foreground">Monitor native downloads, progress, speed, ETA, retry failures, cancel transfers, and reveal completed files.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DownloadMetric label="Active" value={active.length} />
        <DownloadMetric label="Failed" value={failed.length} />
        <DownloadMetric label="Complete" value={completed.length} />
        <DownloadMetric label="Total" value={tasks.length} />
      </div>

      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

      {!tasks.length ? (
        <div className="grid min-h-80 place-items-center rounded-xl border border-dashed p-8 text-center">
          <div className="space-y-3">
            <DownloadIcon className="mx-auto size-10 text-muted-foreground" />
            <div><p className="font-medium">No downloads yet</p><p className="text-sm text-muted-foreground">Download a file from Files or Collections to start a native transfer.</p></div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="flex flex-wrap gap-2 border-b p-3">
            <Button size="sm" variant="outline" disabled={!failed.length} onClick={() => void retryMany(failed)}><RefreshCwIcon />Retry all failed</Button>
            <Button size="sm" variant="outline" disabled={!cancellable.length} onClick={() => void cancelMany(cancellable)}><XIcon />Cancel all</Button>
            <Button size="sm" variant="ghost" disabled={!clearable.length} onClick={() => void clearFinished()}><Trash2Icon />Clear finished</Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>File</TableHead><TableHead className="hidden w-32 sm:table-cell">Status</TableHead><TableHead className="hidden w-72 md:table-cell">Progress</TableHead><TableHead className="hidden w-40 lg:table-cell">Transfer</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
              <TableBody>{[...tasks].reverse().map((task) => <DownloadRow key={task.id} task={task} perform={perform} retry={retry} cancel={cancel} remove={remove} reveal={reveal} />)}</TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

function DownloadRow({ task, perform, retry, cancel, remove, reveal }: {
  task: DownloadTask
  perform: (action: () => Promise<unknown>) => Promise<void>
  retry: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  reveal: (id: string) => Promise<void>
}) {
  const percent = downloadTaskPercent(task)
  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {task.status === "completed" ? <CircleCheckIcon className="size-4 shrink-0" /> : isActiveDownloadTask(task) ? <Loader2Icon className="size-4 shrink-0 animate-spin" /> : <DownloadIcon className="size-4 shrink-0" />}
            <span className="truncate font-medium">{task.fileName}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{downloadTaskStatusLabel(task)} · {formatBytes(task.downloadedBytes)}{task.totalBytes !== undefined ? ` / ${formatBytes(task.totalBytes)}` : ""}</p>
          {task.error ? <p role="alert" className="mt-1 wrap-break-word text-xs text-destructive">{task.error}</p> : null}
        </div>
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">{downloadTaskStatusLabel(task)}</TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="space-y-1">
          <Progress value={percent} className="h-1.5" />
          <div className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground"><span>{formatBytes(task.downloadedBytes)}{task.totalBytes !== undefined ? ` / ${formatBytes(task.totalBytes)}` : ""}</span><span>{Math.round(percent)}%</span></div>
        </div>
      </TableCell>
      <TableCell className="hidden text-xs tabular-nums text-muted-foreground lg:table-cell">
        <div>{task.bytesPerSecond ? `${formatBytes(task.bytesPerSecond)}/s` : "-"}</div>
        <div>{task.etaSeconds !== undefined && isActiveDownloadTask(task) ? `${formatDownloadEta(task.etaSeconds)} left` : ""}</div>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {task.canRetry ? <Button size="icon-sm" variant="ghost" title="Retry" aria-label={`Retry ${task.fileName}`} onClick={() => void perform(() => retry(task.id))}><RefreshCwIcon /></Button> : null}
          {task.canCancel ? <Button size="icon-sm" variant="ghost" title="Cancel" aria-label={`Cancel ${task.fileName}`} onClick={() => void perform(() => cancel(task.id))}><XIcon /></Button> : null}
          {task.canReveal ? <Button size="icon-sm" variant="ghost" title="Reveal in folder" aria-label={`Reveal ${task.fileName} in folder`} onClick={() => void perform(() => reveal(task.id))}><FolderOpenIcon /></Button> : null}
          {task.canRemove ? <Button size="icon-sm" variant="ghost" title="Dismiss" aria-label={`Dismiss ${task.fileName}`} onClick={() => void perform(() => remove(task.id))}><Trash2Icon /></Button> : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function DownloadMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>
}

"use client"

import { ArrowUpRightIcon, CircleAlertIcon, Loader2Icon, UploadIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { BottomDock } from "@/components/app/bottom-dock-stack"
import { useCurrentUser } from "@/components/app/current-user-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useUploads } from "@/components/uploads/upload-provider"
import { isActiveUploadTask } from "@/components/uploads/upload-task"
import { formatBytes } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

export function UploadManagerDock() {
  const pathname = usePathname()
  const currentUser = useCurrentUser()
  const { tasks } = useUploads()

  const href = workspacePath(currentUser.username, "uploads")
  if (pathname === href || pathname === `${href}/`) return null

  const activeTasks = tasks.filter(isActiveUploadTask)
  const failedTasks = tasks.filter((task) => task.status === "error")

  if (!activeTasks.length && !failedTasks.length) return null

  const currentTask = activeTasks.find((task) => task.status === "uploading")
    ?? activeTasks.find((task) => task.status === "finalizing")
    ?? activeTasks[0]

  const relevantTasks = tasks.filter((task) => !["cancelled", "skipped"].includes(task.status))
  const totalBytes = relevantTasks.reduce((total, task) => total + Math.max(0, task.file.size), 0)
  const uploadedBytes = relevantTasks.reduce((total, task) => {
    if (task.status === "completed") return total + Math.max(0, task.file.size)
    return total + Math.min(Math.max(0, task.uploadedBytes), Math.max(0, task.file.size))
  }, 0)
  const progress = totalBytes > 0
    ? Math.min(100, uploadedBytes / totalBytes * 100)
    : 0

  return (
    <BottomDock slot="uploads">
      <div className="flex w-[min(36rem,calc(100vw-1.5rem))] items-center gap-3 rounded-2xl border bg-background/95 px-3 py-2.5 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
        <StatusIcon
          active={activeTasks.length}
          failed={failedTasks.length}
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-medium">
              {activeTasks.length > 0 ? "Uploading" : "Upload failed"}
            </span>

            {activeTasks.length > 0 && (
              <span className="truncate text-xs text-muted-foreground">
                {currentTask?.file.name}
              </span>
            )}

            {failedTasks.length > 0 && (
              <span className="ml-auto shrink-0 text-xs font-medium text-destructive">
                {failedTasks.length} failed
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <Progress
              value={progress}
              className="h-1.5 min-w-0 flex-1"
            />

            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            {activeTasks.length > 0 && (
              <>
                <span className="shrink-0">
                  {activeTasks.length} active
                </span>

                <span aria-hidden>·</span>
              </>
            )}

            <span className="truncate tabular-nums">
              {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
            </span>

            {activeTasks.length > 1 && currentTask && (
              <>
                <span aria-hidden>·</span>

                <span className="shrink-0">
                  +{activeTasks.length - 1} more
                </span>
              </>
            )}
          </div>
        </div>

        <Button
          asChild
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label="Open uploads"
          title="Open uploads"
        >
          <Link href={href}>
            <ArrowUpRightIcon />
          </Link>
        </Button>
      </div>
    </BottomDock>
  )
}

function StatusIcon({
  active,
  failed,
}: {
  active: number
  failed: number
}) {
  if (active > 0) {
    return (
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Loader2Icon className="size-4 animate-spin" />
      </div>
    )
  }

  if (failed > 0) {
    return (
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
        <CircleAlertIcon className="size-4" />
      </div>
    )
  }

  return (
    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
      <UploadIcon className="size-4" />
    </div>
  )
}
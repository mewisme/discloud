"use client"

import { ArrowUpRightIcon, CheckIcon, CircleAlertIcon, Loader2Icon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { BottomDock } from "@/components/app/bottom-dock-stack"
import { useCurrentUser } from "@/components/app/current-user-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useUploads } from "@/components/uploads/upload-provider"
import { isActiveUploadTask } from "@/components/uploads/upload-task"
import { formatBytes } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

const completionHideDelayMs = 3000

export function UploadManagerDock() {
  const pathname = usePathname()
  const currentUser = useCurrentUser()
  const { tasks } = useUploads()
  const [hovered, setHovered] = useState(false)
  const [completionVisible, setCompletionVisible] = useState(false)
  const previousActiveCountRef = useRef(0)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const href = workspacePath(currentUser.username, "uploads")
  const onUploadsPage = pathname === href || pathname === `${href}/`
  const activeTasks = tasks.filter(isActiveUploadTask)
  const failedTasks = tasks.filter((task) => task.status === "error")
  const completedTasks = tasks.filter((task) => task.status === "completed")
  const activeCount = activeTasks.length
  const failedCount = failedTasks.length
  const needsAttention = activeCount > 0 || failedCount > 0

  useEffect(() => {
    const previousActiveCount = previousActiveCountRef.current
    previousActiveCountRef.current = activeCount

    if (needsAttention) {
      setCompletionVisible(false)
      return
    }

    if (previousActiveCount > 0 && completedTasks.length > 0) {
      setCompletionVisible(true)
    }
  }, [activeCount, completedTasks.length, needsAttention])

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = undefined
    }

    if (!completionVisible || hovered || onUploadsPage) return

    hideTimerRef.current = setTimeout(() => {
      setCompletionVisible(false)
      hideTimerRef.current = undefined
    }, completionHideDelayMs)

    return () => {
      if (!hideTimerRef.current) return
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = undefined
    }
  }, [completionVisible, hovered, onUploadsPage])

  useEffect(() => {
    if (onUploadsPage) setCompletionVisible(false)
  }, [onUploadsPage])

  if (onUploadsPage) return null
  if (!needsAttention && !completionVisible) return null

  const finished = !needsAttention && completionVisible
  const currentTask = activeTasks.find((task) => task.status === "uploading")
    ?? activeTasks.find((task) => task.status === "finalizing")
    ?? activeTasks[0]
    ?? completedTasks.at(-1)

  const relevantTasks = tasks.filter((task) => !["cancelled", "skipped"].includes(task.status))
  const totalBytes = relevantTasks.reduce((total, task) => total + Math.max(0, task.file.size), 0)
  const uploadedBytes = relevantTasks.reduce((total, task) => {
    if (task.status === "completed") return total + Math.max(0, task.file.size)
    return total + Math.min(Math.max(0, task.uploadedBytes), Math.max(0, task.file.size))
  }, 0)
  const progress = totalBytes > 0
    ? Math.min(100, uploadedBytes / totalBytes * 100)
    : finished
      ? 100
      : 0

  return (
    <BottomDock slot="uploads">
      <div
        className="flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <StatusIcon
          active={activeCount}
          failed={failedCount}
          finished={finished}
        />

        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-sm font-medium">
            {finished
              ? "Upload complete"
              : activeCount > 0
                ? "Uploading"
                : "Upload failed"}
          </span>

          {currentTask && (
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:block">
              {currentTask.file.name}
            </span>
          )}
        </div>

        <div className="hidden h-5 w-px bg-border sm:block" />

        <Progress
          value={progress}
          className="h-1.5 w-20 shrink-0 sm:w-28"
        />

        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {Math.round(progress)}%
        </span>

        <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground md:block">
          {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
        </span>

        {!finished && activeCount > 1 && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
            {activeCount} active
          </span>
        )}

        {failedCount > 0 && (
          <span className="shrink-0 text-xs font-medium text-destructive">
            {failedCount} failed
          </span>
        )}

        <div className="h-5 w-px bg-border" />

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
  finished,
}: {
  active: number
  failed: number
  finished: boolean
}) {
  if (active > 0) {
    return (
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Loader2Icon className="size-4 animate-spin" />
      </div>
    )
  }

  if (failed > 0) {
    return (
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
        <CircleAlertIcon className="size-4" />
      </div>
    )
  }

  if (finished) {
    return (
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
        <CheckIcon className="size-4" />
      </div>
    )
  }

  return null
}
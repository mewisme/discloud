"use client"

import { ArrowUpRightIcon, CheckIcon, CircleAlertIcon, Loader2Icon } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { BottomDock } from "@/components/app/bottom-dock-stack"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useUploadDockState } from "@/components/uploads/upload-provider"
import { uploadTaskPercent } from "@/components/uploads/upload-task"
import { formatBytes } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

const completionHideDelayMs = 3000

export function UploadManagerDock({
  username,
}: {
  username: string
}) {
  const {
    activeCount,
    failedCount,
    currentTask,
    completionVersion,
  } = useUploadDockState()

  const [hovered, setHovered] = useState(false)
  const [completionVisible, setCompletionVisible] = useState(false)
  const previousCompletionVersion = useRef(completionVersion)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const needsAttention = activeCount > 0
    || failedCount > 0

  const justCompleted = !needsAttention
    && completionVersion
    !== previousCompletionVersion.current

  const showCompletion = completionVisible
    || justCompleted

  useEffect(() => {
    const completed = completionVersion
      !== previousCompletionVersion.current

    previousCompletionVersion.current =
      completionVersion

    if (
      activeCount > 0
      || failedCount > 0
    ) {
      setCompletionVisible(false)
      return
    }

    if (completed) {
      setCompletionVisible(true)
    }
  }, [
    activeCount,
    completionVersion,
    failedCount,
  ])

  useEffect(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }

    if (
      !completionVisible
      || hovered
    ) return

    hideTimer.current = setTimeout(() => {
      setCompletionVisible(false)
      hideTimer.current = undefined
    }, completionHideDelayMs)

    return () => {
      if (!hideTimer.current) return

      clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }
  }, [
    completionVisible,
    hovered,
  ])

  if (
    !needsAttention
    && !showCompletion
  ) return null

  const finished = !needsAttention
    && showCompletion

  const progress = finished
    ? 100
    : currentTask
      ? uploadTaskPercent(currentTask)
      : 0

  const uploadedBytes =
    currentTask?.uploadedBytes ?? 0

  const totalBytes =
    currentTask?.file.size ?? 0

  const href = workspacePath(
    username,
    "uploads",
  )

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

        {!finished && currentTask && (
          <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground md:block">
            {formatBytes(uploadedBytes)}
            {" / "}
            {formatBytes(totalBytes)}
          </span>
        )}

        {activeCount > 1 && (
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
        <Loader2Icon
          className="size-4 animate-spin"
          aria-hidden
        />
      </div>
    )
  }

  if (failed > 0) {
    return (
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
        <CircleAlertIcon
          className="size-4"
          aria-hidden
        />
      </div>
    )
  }

  if (finished) {
    return (
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
        <CheckIcon
          className="size-4"
          aria-hidden
        />
      </div>
    )
  }

  return null
}
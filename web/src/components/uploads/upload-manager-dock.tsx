"use client"

import { BottomDock } from "@discloud/app-ui/shell/dock-stack"
import { Button } from "@discloud/ui/components/button"
import { Progress } from "@discloud/ui/components/progress"
import { ArrowUpRightIcon, CheckIcon, CircleAlertIcon, Loader2Icon } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { useUploadDockState } from "@/components/uploads/upload-provider"
import { uploadTaskPercent } from "@/components/uploads/upload-task"
import { formatBytes } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

const completionHideDelayMs = 3000

export function UploadManagerDock({ username }: { username: string }) {
  const { activeCount, failedCount, currentTask, completionVersion } = useUploadDockState()
  const [hovered, setHovered] = useState(false)
  const [completionVisible, setCompletionVisible] = useState(false)
  const previousCompletionVersion = useRef(completionVersion)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const needsAttention = activeCount > 0 || failedCount > 0
  const justCompleted = !needsAttention && completionVersion !== previousCompletionVersion.current
  const showCompletion = completionVisible || justCompleted

  useEffect(() => {
    const completed = completionVersion !== previousCompletionVersion.current
    previousCompletionVersion.current = completionVersion

    if (activeCount > 0 || failedCount > 0) {
      setCompletionVisible(false)
      return
    }

    if (completed) setCompletionVisible(true)
  }, [activeCount, completionVersion, failedCount])

  useEffect(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }

    if (!completionVisible || hovered) return

    hideTimer.current = setTimeout(() => {
      setCompletionVisible(false)
      hideTimer.current = undefined
    }, completionHideDelayMs)

    return () => {
      if (!hideTimer.current) return
      clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }
  }, [completionVisible, hovered])

  if (!needsAttention && !showCompletion) return null

  const finished = !needsAttention && showCompletion
  const progress = finished ? 100 : currentTask ? uploadTaskPercent(currentTask) : 0
  const uploadedBytes = currentTask?.uploadedBytes ?? 0
  const totalBytes = currentTask?.file.size ?? 0

  return (
    <BottomDock slot="uploads">
      <div
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150 sm:gap-2"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <StatusIcon active={activeCount} failed={failedCount} finished={finished} />

        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-sm font-medium max-[359px]:hidden">{finished ? "Upload complete" : activeCount > 0 ? "Uploading" : "Upload failed"}</span>
          {currentTask ? <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:block">{currentTask.file.name}</span> : null}
        </div>

        <div className="hidden h-5 w-px bg-border sm:block" />
        <Progress value={progress} className="h-1.5 w-14 shrink-0 min-[360px]:w-20 sm:w-24 lg:w-28" />
        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Math.round(progress)}%</span>

        {!finished && currentTask ? <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground xl:block">{formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}</span> : null}
        {activeCount > 1 ? <span className="hidden shrink-0 text-xs text-muted-foreground xl:block">{activeCount} active</span> : null}
        {failedCount > 0 ? <span className="hidden shrink-0 text-xs font-medium text-destructive min-[420px]:inline">{failedCount} failed</span> : null}

        <div className="h-5 w-px bg-border" />
        <Button asChild size="icon-sm" variant="ghost" className="shrink-0" aria-label="Open uploads" title="Open uploads">
          <Link href={workspacePath(username, "uploads")}><ArrowUpRightIcon /></Link>
        </Button>
      </div>
    </BottomDock>
  )
}

function StatusIcon({ active, failed, finished }: { active: number; failed: number; finished: boolean }) {
  if (active > 0) return <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary sm:size-8"><Loader2Icon className="size-4 animate-spin" aria-hidden /></div>
  if (failed > 0) return <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive sm:size-8"><CircleAlertIcon className="size-4" aria-hidden /></div>
  if (finished) return <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-foreground sm:size-8"><CheckIcon className="size-4" aria-hidden /></div>
  return null
}

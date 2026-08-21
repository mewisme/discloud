"use client"

import { ArrowUpRightIcon, Loader2Icon, UploadIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { BottomDock } from "@/components/app/bottom-dock-stack"
import { useCurrentUser } from "@/components/app/current-user-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useUploads } from "@/components/uploads/upload-provider"
import { isActiveUploadTask } from "@/components/uploads/upload-task"
import { workspacePath } from "@/lib/workspace/navigation"

export function UploadManagerDock() {
  const pathname = usePathname()
  const currentUser = useCurrentUser()
  const { tasks } = useUploads()

  if (!tasks.length) return null

  const href = workspacePath(currentUser.username, "uploads")
  if (pathname === href || pathname === `${href}/`) return null

  const active = tasks.filter(isActiveUploadTask).length
  const failed = tasks.filter((task) => task.status === "error").length
  const progressTasks = tasks.filter((task) => task.status !== "cancelled" && task.status !== "skipped")
  const totalBytes = progressTasks.reduce((total, task) => total + Math.max(0, task.file.size), 0)
  const uploadedBytes = progressTasks.reduce((total, task) => {
    if (task.status === "completed") return total + Math.max(0, task.file.size)
    return total + Math.min(Math.max(0, task.uploadedBytes), Math.max(0, task.file.size))
  }, 0)
  const progress = totalBytes > 0
    ? Math.min(100, uploadedBytes / totalBytes * 100)
    : progressTasks.length > 0 && active === 0
      ? 100
      : 0
  const summary = active > 0
    ? `${active} active${failed > 0 ? ` · ${failed} failed` : ""}`
    : failed > 0
      ? `${failed} failed`
      : `${tasks.length} item${tasks.length === 1 ? "" : "s"}`

  return (
    <BottomDock slot="uploads" className="w-full max-w-xl">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
          {active > 0
            ? <Loader2Icon className="size-4 animate-spin" />
            : <UploadIcon className="size-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium">Uploads</span>

            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {summary}
            </span>

            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>

          <Progress value={progress} className="mt-1.5 h-1.5" />
        </div>

        <Button
          asChild
          size="icon-sm"
          variant="ghost"
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
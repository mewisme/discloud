import type { ReactNode } from "react"
import { useEffect, useMemo, useRef } from "react"

import { sendDesktopNotification } from "../../desktop/core/notifications"
import { applyDownloadRemovedEvent, applyDownloadTaskEvent, type DownloadTask, replaceDownloadSnapshot, resetDownloadProjection, useDownloadSummary, useDownloadTasks } from "../core/download-store"
import { cancelNativeDownloadTask, removeNativeDownloadTask, retryNativeDownloadTask, revealNativeDownloadTask, subscribeNativeDownloads } from "../core/native"

const downloadActions = {
  retry: retryNativeDownloadTask,
  cancel: cancelNativeDownloadTask,
  remove: removeNativeDownloadTask,
  reveal: revealNativeDownloadTask,
}

export function DesktopDownloadProvider({ children }: { children: ReactNode }) {
  const tasks = useDownloadTasks()
  const previousStatuses = useRef(new Map<string, DownloadTask["status"]>())

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined

    void subscribeNativeDownloads({
      onSnapshot: (snapshot) => {
        if (!disposed) replaceDownloadSnapshot(snapshot)
      },
      onTask: (event) => {
        if (!disposed) applyDownloadTaskEvent(event)
      },
      onRemoved: (event) => {
        if (!disposed) applyDownloadRemovedEvent(event)
      },
    }).then((dispose) => {
      if (disposed) {
        dispose()
        resetDownloadProjection()
      } else {
        unsubscribe = dispose
      }
    }).catch(() => {
      if (!disposed) resetDownloadProjection()
    })

    return () => {
      disposed = true
      unsubscribe?.()
      resetDownloadProjection()
    }
  }, [])

  useEffect(() => {
    const previous = previousStatuses.current
    const next = new Map<string, DownloadTask["status"]>()

    for (const task of tasks) {
      const status = previous.get(task.id)
      if (status && status !== "completed" && task.status === "completed") void sendDesktopNotification("Download complete", task.fileName)
      if (status && status !== "error" && task.status === "error") void sendDesktopNotification("Download failed", `${task.fileName}: ${task.error ?? "Download failed."}`)
      next.set(task.id, task.status)
    }

    previousStatuses.current = next
  }, [tasks])

  return children
}

export function useDownloadActions() {
  return downloadActions
}

export function useDownloads() {
  const tasks = useDownloadTasks()
  return useMemo(() => ({ tasks, ...downloadActions }), [tasks])
}

export { useDownloadSummary, useDownloadTasks }
export type { DownloadSummary, DownloadTask, DownloadTaskStatus } from "../core/download-store"

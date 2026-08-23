import { DockStackProvider } from "@discloud/app-ui/shell/dock-stack"
import type { ReactNode } from "react"
import { useEffect, useMemo, useRef } from "react"

import { useDesktopSession } from "#components/desktop-session"

import { sendDesktopNotification } from "../../desktop/core/notifications"
import { addNativeUploadPaths, cancelNativeUploadTask, removeNativeUploadTask, retryNativeUploadTask, subscribeNativeUploads } from "../core/native"
import { applyUploadRemovedEvent, applyUploadTaskEvent, replaceUploadSnapshot, resetUploadProjection, useUploadDockState, useUploadTasks } from "../core/upload-store"
import { DesktopUploadDock } from "./upload-dock"

export const UPLOAD_COMPLETED_EVENT = "discloud:upload-completed"

export type UploadCompletedDetail = {
  folderId: string
}

const uploadActions = {
  addPaths: addNativeUploadPaths,
  retry: retryNativeUploadTask,
  cancel: cancelNativeUploadTask,
  remove: removeNativeUploadTask,
}

export function DesktopUploadProvider({ children }: { children: ReactNode }) {
  const { state, refreshUser } = useDesktopSession()

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined

    void subscribeNativeUploads({
      onSnapshot: (snapshot) => {
        if (!disposed) replaceUploadSnapshot(snapshot)
      },
      onTask: (event) => {
        if (!disposed) applyUploadTaskEvent(event)
      },
      onRemoved: (event) => {
        if (!disposed) applyUploadRemovedEvent(event)
      },
      onFolderChanged: ({ folderId }) => {
        if (!disposed) window.dispatchEvent(new CustomEvent<UploadCompletedDetail>(UPLOAD_COMPLETED_EVENT, { detail: { folderId } }))
      },
      onUnauthorized: () => {
        if (!disposed) void refreshUser()
      },
    }).then((dispose) => {
      if (disposed) {
        dispose()
        resetUploadProjection()
      } else {
        unsubscribe = dispose
      }
    }).catch(() => {
      if (!disposed) resetUploadProjection()
    })

    return () => {
      disposed = true
      unsubscribe?.()
      resetUploadProjection()
    }
  }, [refreshUser])

  const username = state.status === "connected" ? state.user?.username : undefined

  return (
    <DockStackProvider>
      {children}
      <DesktopUploadNotifications />
      {username ? <DesktopUploadDock username={username} /> : null}
    </DockStackProvider>
  )
}

export function useUploadActions() {
  return uploadActions
}

export function useUploads() {
  const tasks = useUploadTasks()

  return useMemo(() => ({ tasks, ...uploadActions }), [tasks])
}

function DesktopUploadNotifications() {
  const { failedCount, completionVersion, currentTask } = useUploadDockState()
  const previousFailedCount = useRef(failedCount)
  const previousCompletionVersion = useRef(completionVersion)

  useEffect(() => {
    if (completionVersion > previousCompletionVersion.current) void sendDesktopNotification("Uploads complete", "All queued uploads completed successfully.")
    previousCompletionVersion.current = completionVersion
  }, [completionVersion])

  useEffect(() => {
    if (failedCount > previousFailedCount.current) {
      const added = failedCount - previousFailedCount.current
      const body = added === 1 && currentTask?.file.name ? `${currentTask.file.name} needs attention.` : `${added} uploads need attention.`
      void sendDesktopNotification("Upload failed", body)
    }

    previousFailedCount.current = failedCount
  }, [currentTask?.file.name, failedCount])

  return null
}

export { useUploadDockState, useUploadTasks }
export type { UploadDockState, UploadTask, UploadTaskStatus } from "../core/upload-store"

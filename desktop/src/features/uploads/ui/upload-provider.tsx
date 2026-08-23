import { DockStackProvider } from "@discloud/app-ui/shell/dock-stack"
import type { ReactNode } from "react"
import { useEffect, useMemo, useRef } from "react"

import { useDesktopSession } from "#components/desktop-session"

import { sendDesktopNotification } from "../../desktop/core/notifications"
import { uploadEngine } from "../core/upload-engine"
import { useUploadDockState, useUploadTasks } from "../core/upload-store"
import { DesktopUploadDock } from "./upload-dock"

export const UPLOAD_COMPLETED_EVENT = "discloud:upload-completed"

export type UploadCompletedDetail = {
  folderId: string
}

const uploadActions = {
  addPaths: (folderId: string, paths: readonly string[]) => uploadEngine.addPaths(folderId, paths),
  retry: (taskId: string) => uploadEngine.retry(taskId),
  cancel: (taskId: string) => uploadEngine.cancel(taskId),
  remove: (taskId: string) => uploadEngine.remove(taskId),
}

export function DesktopUploadProvider({ children }: { children: ReactNode }) {
  const { state, refreshUser } = useDesktopSession()

  useEffect(() => {
    uploadEngine.configure({
      onUnauthorized: () => void refreshUser(),
      onFolderChanged: (folderId) => {
        window.dispatchEvent(new CustomEvent<UploadCompletedDetail>(UPLOAD_COMPLETED_EVENT, { detail: { folderId } }))
      },
    })

    return () => uploadEngine.reset()
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

import type { ReactNode } from "react"
import { useEffect, useMemo } from "react"

import { useDesktopSession } from "#components/desktop-session"

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
        window.dispatchEvent(new CustomEvent<UploadCompletedDetail>(UPLOAD_COMPLETED_EVENT, {
          detail: { folderId },
        }))
      },
    })

    return () => uploadEngine.reset()
  }, [refreshUser])

  const username = state.status === "connected" ? state.user?.username : undefined

  return (
    <>
      {children}
      {username ? <DesktopUploadDock username={username} /> : null}
    </>
  )
}

export function useUploadActions() {
  return uploadActions
}

export function useUploads() {
  const tasks = useUploadTasks()

  return useMemo(() => ({
    tasks,
    ...uploadActions,
  }), [tasks])
}

export { useUploadDockState, useUploadTasks }
export type { UploadDockState, UploadTask, UploadTaskStatus } from "../core/upload-store"
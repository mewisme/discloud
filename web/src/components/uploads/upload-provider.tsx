"use client"

import { useRouter } from "next/navigation"
import type { ReactNode } from "react"
import { useEffect, useMemo, useRef } from "react"

import { uploadEngine } from "@/lib/uploads/upload-engine"
import { useUploadDockState, useUploadTasks } from "@/lib/uploads/upload-store"

export const UPLOAD_COMPLETED_EVENT = "discloud:upload-completed"

export type UploadCompletedDetail = {
  folderId: string
}

export { useUploadDockState, useUploadTasks }
export type { UploadDockState, UploadTask, UploadTaskStatus } from "@/lib/uploads/upload-store"

type UploadActions = {
  addFiles: (folderId: string, files: readonly File[]) => void
  retry: (taskId: string) => void
  cancel: (taskId: string) => Promise<void>
  remove: (taskId: string) => void
}

const uploadActions: UploadActions = {
  addFiles: (folderId, files) => uploadEngine.addFiles(folderId, files),
  retry: (taskId) => uploadEngine.retry(taskId),
  cancel: (taskId) => uploadEngine.cancel(taskId),
  remove: (taskId) => uploadEngine.remove(taskId),
}

export function UploadProvider({
  children,
}: {
  children: ReactNode
}) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  useEffect(() => {
    uploadEngine.configure({
      onUnauthorized: () => {
        routerRef.current.replace("/login")
        routerRef.current.refresh()
      },
      onFolderChanged: (folderId) => {
        window.dispatchEvent(
          new CustomEvent<UploadCompletedDetail>(
            UPLOAD_COMPLETED_EVENT,
            { detail: { folderId } },
          ),
        )
      },
    })

    return () => uploadEngine.reset()
  }, [])

  return children
}

export function useUploadActions() {
  return uploadActions
}

export function useUploads() {
  const tasks = useUploadTasks()

  return useMemo(
    () => ({
      tasks,
      ...uploadActions,
    }),
    [tasks],
  )
}
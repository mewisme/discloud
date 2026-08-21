"use client"

import { useRouter } from "next/navigation"
import type { ReactNode } from "react"
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import { APIError } from "@/lib/api/types"
import { isFileAlreadyExistsError, type PlannedUploadFile, planUploadFiles } from "@/lib/uploads/folder"
import { uploadFile, withUploadSlot } from "@/lib/uploads/upload"

export const UPLOAD_COMPLETED_EVENT = "discloud:upload-completed"

export type UploadCompletedDetail = {
  folderId: string
}

export type UploadTaskStatus = "queued" | "preparing" | "uploading" | "finalizing" | "completed" | "skipped" | "error" | "cancelling" | "cancelled"

export type UploadTask = {
  id: string
  file: File
  folderId: string
  relativePath?: string
  skipExisting?: boolean
  sessionId?: string
  status: UploadTaskStatus
  uploadedBytes: number
  error?: string
}

type UploadActionsContextValue = {
  addFiles: (folderId: string, files: readonly File[]) => void
  retry: (taskId: string) => void
  cancel: (taskId: string) => Promise<void>
  remove: (taskId: string) => void
}

const UploadTasksContext = createContext<UploadTask[] | null>(null)
const UploadActionsContext = createContext<UploadActionsContextValue | null>(null)

export function UploadProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const tasksRef = useRef<UploadTask[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const pendingProgress = useRef(new Map<string, number>())
  const progressFrame = useRef<number>(undefined)
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort())
    pendingProgress.current.clear()
    if (progressFrame.current !== undefined) cancelAnimationFrame(progressFrame.current)
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  const patchTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    if (patch.status && patch.status !== "uploading") pendingProgress.current.delete(id)
    const next = tasksRef.current.map((task) => task.id === id ? { ...task, ...patch } : task)
    tasksRef.current = next
    setTasks(next)
  }, [])

  const queueProgress = useCallback((id: string, uploadedBytes: number) => {
    pendingProgress.current.set(id, uploadedBytes)
    if (progressFrame.current !== undefined) return

    progressFrame.current = requestAnimationFrame(() => {
      progressFrame.current = undefined
      const updates = new Map(pendingProgress.current)
      pendingProgress.current.clear()
      if (!updates.size) return

      let changed = false
      tasksRef.current = tasksRef.current.map((task) => {
        const uploaded = updates.get(task.id)
        if (uploaded === undefined || task.status !== "uploading") return task
        const nextUploaded = Math.max(task.uploadedBytes, uploaded)
        if (nextUploaded === task.uploadedBytes) return task
        changed = true
        return { ...task, uploadedBytes: nextUploaded }
      })
      if (!changed) return

      startTransition(() => {
        setTasks((current) => current.map((task) => {
          const uploaded = updates.get(task.id)
          if (uploaded === undefined || task.status !== "uploading") return task
          const nextUploaded = Math.max(task.uploadedBytes, uploaded)
          return nextUploaded === task.uploadedBytes ? task : { ...task, uploadedBytes: nextUploaded }
        }))
      })
    })
  }, [])

  const taskById = useCallback((id: string) => tasksRef.current.find((task) => task.id === id), [])

  const scheduleServerRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined
      router.refresh()
    }, 200)
  }, [router])

  const notifyCompleted = useCallback((folderId: string) => {
    window.dispatchEvent(new CustomEvent<UploadCompletedDetail>(UPLOAD_COMPLETED_EVENT, { detail: { folderId } }))
    scheduleServerRefresh()
  }, [scheduleServerRefresh])

  const execute = useCallback(async (task: UploadTask) => {
    const controller = new AbortController()
    controllers.current.set(task.id, controller)
    patchTask(task.id, { status: "preparing", error: undefined })

    try {
      await uploadFile({
        file: task.file,
        folderId: task.folderId,
        sessionId: task.sessionId,
        signal: controller.signal,
        callbacks: {
          onSession: (sessionId) => patchTask(task.id, { sessionId, status: "uploading" }),
          onProgress: (uploadedBytes) => queueProgress(task.id, uploadedBytes),
          onFinalizing: () => patchTask(task.id, { status: "finalizing" }),
        },
      })

      patchTask(task.id, { status: "completed", uploadedBytes: task.file.size })
      notifyCompleted(task.folderId)
    } catch (error) {
      const current = taskById(task.id)
      if (current?.status === "cancelling" || current?.status === "cancelled") return

      if (task.skipExisting && isFileAlreadyExistsError(error)) {
        patchTask(task.id, { status: "skipped", uploadedBytes: 0, error: undefined })
        return
      }

      if (error instanceof APIError && error.status === 401) {
        router.replace("/login")
        router.refresh()
      }

      patchTask(task.id, { status: "error", error: uploadErrorMessage(error) })
    } finally {
      controllers.current.delete(task.id)
    }
  }, [notifyCompleted, patchTask, queueProgress, router, taskById])

  const schedule = useCallback((task: UploadTask) => {
    void withUploadSlot(async () => {
      const current = taskById(task.id)
      if (!current || current.status !== "queued") return
      await execute(current)
    })
  }, [execute, taskById])

  const enqueueFiles = useCallback((files: readonly PlannedUploadFile[]) => {
    const known = new Set(
      tasksRef.current
        .filter((task) => !["completed", "cancelled", "skipped"].includes(task.status))
        .map((task) => `${task.folderId}\0${task.file.name}`),
    )
    const additions: UploadTask[] = []
    let skipped = 0

    for (const planned of files) {
      const key = `${planned.folderId}\0${planned.file.name}`
      if (known.has(key)) {
        skipped++
        continue
      }

      known.add(key)
      additions.push({
        id: crypto.randomUUID(),
        file: planned.file,
        folderId: planned.folderId,
        ...(planned.relativePath !== planned.file.name ? { relativePath: planned.relativePath } : {}),
        ...(planned.skipExisting ? { skipExisting: true } : {}),
        status: "queued",
        uploadedBytes: 0,
      })
    }

    if (skipped) toast.warning(`${skipped} duplicate upload${skipped === 1 ? "" : "s"} skipped`)
    if (!additions.length) return

    const next = [...tasksRef.current, ...additions]
    tasksRef.current = next
    setTasks(next)
    additions.forEach(schedule)
  }, [schedule])

  const prepareFiles = useCallback(async (folderId: string, files: readonly File[]) => {
    try {
      const plan = await planUploadFiles(folderId, files)
      if (plan.createdFolders > 0) notifyCompleted(folderId)
      enqueueFiles(plan.files)
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        router.replace("/login")
        router.refresh()
      }
      toast.error(uploadErrorMessage(error))
    }
  }, [enqueueFiles, notifyCompleted, router])

  const addFiles = useCallback((folderId: string, files: readonly File[]) => {
    if (!files.length) return
    void prepareFiles(folderId, files)
  }, [prepareFiles])

  const retry = useCallback((taskId: string) => {
    const task = taskById(taskId)
    if (!task || task.status !== "error") return

    const next = {
      ...task,
      status: "queued" as const,
      uploadedBytes: task.sessionId ? task.uploadedBytes : 0,
      error: undefined,
    }

    patchTask(taskId, next)
    schedule(next)
  }, [patchTask, schedule, taskById])

  const cancel = useCallback(async (taskId: string) => {
    const task = taskById(taskId)
    if (!task) return

    if (task.status === "queued") {
      patchTask(taskId, { status: "cancelled" })
      return
    }
    if (!task.sessionId || task.status === "completed" || task.status === "skipped" || task.status === "cancelled" || task.status === "finalizing") return

    patchTask(taskId, { status: "cancelling", error: undefined })
    controllers.current.get(taskId)?.abort(new DOMException("Upload cancelled", "AbortError"))

    try {
      await apiJSON<void>(`/api/v1/uploads/${task.sessionId}`, { method: "DELETE" })
      patchTask(taskId, { status: "cancelled" })
      scheduleServerRefresh()
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        router.replace("/login")
        router.refresh()
      }
      patchTask(taskId, { status: "error", error: uploadErrorMessage(error) })
    }
  }, [patchTask, router, scheduleServerRefresh, taskById])

  const remove = useCallback((taskId: string) => {
    const task = taskById(taskId)
    if (!task) return
    if (!["completed", "skipped", "cancelled"].includes(task.status) && !(task.status === "error" && !task.sessionId)) return

    const next = tasksRef.current.filter((item) => item.id !== taskId)
    tasksRef.current = next
    setTasks(next)
  }, [taskById])

  const actions = useMemo(() => ({ addFiles, retry, cancel, remove }), [addFiles, cancel, remove, retry])

  return (
    <UploadActionsContext.Provider value={actions}>
      <UploadTasksContext.Provider value={tasks}>
        {children}
      </UploadTasksContext.Provider>
    </UploadActionsContext.Provider>
  )
}

export function useUploadTasks() {
  const context = useContext(UploadTasksContext)
  if (!context) throw new Error("useUploadTasks must be used inside UploadProvider")
  return context
}

export function useUploadActions() {
  const context = useContext(UploadActionsContext)
  if (!context) throw new Error("useUploadActions must be used inside UploadProvider")
  return context
}

export function useUploads() {
  const tasks = useUploadTasks()
  const actions = useUploadActions()
  return useMemo(() => ({ tasks, ...actions }), [actions, tasks])
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof APIError) return error.requestID ? `${error.message} · ${error.requestID}` : error.message
  if (error instanceof Error && error.name !== "AbortError") return error.message
  return "Upload failed"
}
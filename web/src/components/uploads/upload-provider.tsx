"use client"

import { useRouter } from "next/navigation"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import { APIError } from "@/lib/api/types"
import { isFileAlreadyExistsError, type PlannedUploadFile, planUploadFiles } from "@/lib/uploads/folder"
import type { PendingThumbnail } from "@/lib/uploads/thumbnails"
import { generateUploadThumbnail, settleUploadThumbnail } from "@/lib/uploads/thumbnails"
import { uploadFile, uploadFileConcurrency, withUploadSlot } from "@/lib/uploads/upload"

export const UPLOAD_COMPLETED_EVENT = "discloud:upload-completed"

const uploadProgressPublishIntervalMs = 200

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

export type UploadDockState = {
  activeCount: number
  failedCount: number
  currentTask?: UploadTask
  completionVersion: number
}

type UploadActionsContextValue = {
  addFiles: (folderId: string, files: readonly File[]) => void
  retry: (taskId: string) => void
  cancel: (taskId: string) => Promise<void>
  remove: (taskId: string) => void
}

const emptyTasks: UploadTask[] = []
const emptyDockState: UploadDockState = {
  activeCount: 0,
  failedCount: 0,
  completionVersion: 0,
}

class UploadStore {
  private readonly tasks = new Map<string, UploadTask>()
  private order: string[] = []
  private taskSnapshot = emptyTasks
  private taskSnapshotDirty = false
  private readonly taskListeners = new Set<() => void>()
  private dockState = emptyDockState
  private readonly dockListeners = new Set<() => void>()

  get(id: string) {
    return this.tasks.get(id)
  }

  add(additions: readonly UploadTask[]) {
    if (!additions.length) return

    for (const task of additions) {
      if (this.tasks.has(task.id)) continue
      this.tasks.set(task.id, task)
      this.order.push(task.id)
    }

    this.markTasksChanged()
    this.refreshDock()
  }

  patch(id: string, patch: Partial<UploadTask>) {
    const current = this.tasks.get(id)
    if (!current) return

    const next = { ...current, ...patch }
    this.tasks.set(id, next)
    this.markTasksChanged()
    this.refreshDock(patch.status === "completed")
    return next
  }

  updateProgress(updates: ReadonlyMap<string, number>) {
    let changed = false
    let currentTask = this.dockState.currentTask
    let currentTaskChanged = false

    for (const [id, uploadedBytes] of updates) {
      const task = this.tasks.get(id)
      if (!task || task.status !== "uploading") continue

      const nextUploaded = Math.max(task.uploadedBytes, uploadedBytes)
      if (nextUploaded === task.uploadedBytes) continue

      const next = { ...task, uploadedBytes: nextUploaded }
      this.tasks.set(id, next)
      changed = true

      if (currentTask?.id === id) {
        currentTask = next
        currentTaskChanged = true
      }
    }

    if (!changed) return
    this.markTasksChanged()

    if (currentTaskChanged) {
      this.dockState = { ...this.dockState, currentTask }
      this.emitDock()
    }
  }

  remove(id: string) {
    if (!this.tasks.delete(id)) return
    this.order = this.order.filter((taskId) => taskId !== id)
    this.markTasksChanged()
    this.refreshDock()
  }

  clear() {
    if (!this.order.length) return

    this.tasks.clear()
    this.order = []
    this.taskSnapshot = emptyTasks
    this.taskSnapshotDirty = false
    this.taskListeners.forEach((listener) => listener())

    this.dockState = emptyDockState
    this.emitDock()
  }

  getTasksSnapshot = () => {
    if (!this.taskSnapshotDirty) return this.taskSnapshot

    const snapshot: UploadTask[] = []
    for (const id of this.order) {
      const task = this.tasks.get(id)
      if (task) snapshot.push(task)
    }

    this.taskSnapshot = snapshot
    this.taskSnapshotDirty = false
    return snapshot
  }

  getServerTasksSnapshot = () => emptyTasks

  subscribeTasks = (listener: () => void) => {
    this.taskListeners.add(listener)
    return () => this.taskListeners.delete(listener)
  }

  getDockSnapshot = () => this.dockState

  getServerDockSnapshot = () => emptyDockState

  subscribeDock = (listener: () => void) => {
    this.dockListeners.add(listener)
    return () => this.dockListeners.delete(listener)
  }

  private markTasksChanged() {
    this.taskSnapshotDirty = true
    this.taskListeners.forEach((listener) => listener())
  }

  private emitDock() {
    this.dockListeners.forEach((listener) => listener())
  }

  private refreshDock(completedCandidate = false) {
    let activeCount = 0
    let failedCount = 0
    let uploading: UploadTask | undefined
    let finalizing: UploadTask | undefined
    let activeFallback: UploadTask | undefined
    let lastFailed: UploadTask | undefined

    for (const id of this.order) {
      const task = this.tasks.get(id)
      if (!task) continue

      if (isActiveUploadStatus(task.status)) {
        activeCount++
        if (!activeFallback) activeFallback = task
        if (!uploading && task.status === "uploading") uploading = task
        if (!finalizing && task.status === "finalizing") finalizing = task
      }

      if (task.status === "error") {
        failedCount++
        lastFailed = task
      }
    }

    const currentTask = uploading ?? finalizing ?? activeFallback ?? lastFailed
    const completionVersion = completedCandidate
      && this.dockState.activeCount > 0
      && activeCount === 0
      && failedCount === 0
      ? this.dockState.completionVersion + 1
      : this.dockState.completionVersion

    if (
      this.dockState.activeCount === activeCount
      && this.dockState.failedCount === failedCount
      && this.dockState.currentTask === currentTask
      && this.dockState.completionVersion === completionVersion
    ) return

    this.dockState = {
      activeCount,
      failedCount,
      currentTask,
      completionVersion,
    }
    this.emitDock()
  }
}

const uploadStore = new UploadStore()
const UploadActionsContext = createContext<UploadActionsContextValue | null>(null)

export function UploadProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const controllers = useRef(new Map<string, AbortController>())
  const pendingProgress = useRef(new Map<string, number>())
  const progressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const queue = useRef<string[]>([])
  const queueCursor = useRef(0)
  const activeFiles = useRef(0)
  const mounted = useRef(true)
  const pumpRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      controllers.current.forEach((controller) => controller.abort())
      controllers.current.clear()
      pendingProgress.current.clear()
      queue.current = []
      queueCursor.current = 0

      if (progressTimer.current) {
        clearTimeout(progressTimer.current)
        progressTimer.current = undefined
      }

      uploadStore.clear()
    }
  }, [])

  const patchTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    if (patch.status && patch.status !== "uploading") pendingProgress.current.delete(id)
    return uploadStore.patch(id, patch)
  }, [])

  const queueProgress = useCallback((id: string, uploadedBytes: number) => {
    pendingProgress.current.set(id, uploadedBytes)
    if (progressTimer.current) return

    progressTimer.current = setTimeout(() => {
      progressTimer.current = undefined
      if (!pendingProgress.current.size) return

      const updates = new Map(pendingProgress.current)
      pendingProgress.current.clear()
      uploadStore.updateProgress(updates)
    }, uploadProgressPublishIntervalMs)
  }, [])

  const taskById = useCallback((id: string) => uploadStore.get(id), [])

  const notifyCompleted = useCallback((folderId: string) => {
    window.dispatchEvent(new CustomEvent<UploadCompletedDetail>(
      UPLOAD_COMPLETED_EVENT,
      { detail: { folderId } },
    ))
  }, [])

  const execute = useCallback(async (task: UploadTask) => {
    const controller = new AbortController()
    controllers.current.set(task.id, controller)
    patchTask(task.id, { status: "preparing", error: undefined })

    let thumbnail: PendingThumbnail | undefined

    try {
      await uploadFile({
        file: task.file,
        folderId: task.folderId,
        sessionId: task.sessionId,
        signal: controller.signal,
        callbacks: {
          onSession: (sessionId) => {
            patchTask(task.id, { sessionId, status: "uploading" })
            thumbnail ??= generateUploadThumbnail(task.file)
          },
          onProgress: (uploadedBytes) => queueProgress(task.id, uploadedBytes),
          onFinalizing: () => patchTask(task.id, { status: "finalizing" }),
          onCompleted: ({ id }) => void settleUploadThumbnail(
            id,
            thumbnail,
            () => notifyCompleted(task.folderId),
          ),
        },
      })

      patchTask(task.id, {
        status: "completed",
        uploadedBytes: task.file.size,
      })
      notifyCompleted(task.folderId)
    } catch (error) {
      const current = taskById(task.id)
      if (current?.status === "cancelling" || current?.status === "cancelled") return

      if (task.skipExisting && isFileAlreadyExistsError(error)) {
        patchTask(task.id, {
          status: "skipped",
          uploadedBytes: 0,
          error: undefined,
        })
        return
      }

      if (error instanceof APIError && error.status === 401) {
        router.replace("/login")
        router.refresh()
      }

      patchTask(task.id, {
        status: "error",
        error: uploadErrorMessage(error),
      })
    } finally {
      controllers.current.delete(task.id)
    }
  }, [notifyCompleted, patchTask, queueProgress, router, taskById])

  const takeQueuedTask = useCallback(() => {
    while (queueCursor.current < queue.current.length) {
      const id = queue.current[queueCursor.current++]
      const task = uploadStore.get(id)
      if (task?.status === "queued") return task
    }

    queue.current = []
    queueCursor.current = 0
    return undefined
  }, [])

  const pumpUploads = useCallback(() => {
    if (!mounted.current) return

    while (activeFiles.current < uploadFileConcurrency) {
      const task = takeQueuedTask()
      if (!task) return

      activeFiles.current++

      void withUploadSlot(() => execute(task)).finally(() => {
        activeFiles.current = Math.max(0, activeFiles.current - 1)
        if (mounted.current) pumpRef.current()
      })
    }
  }, [execute, takeQueuedTask])

  pumpRef.current = pumpUploads

  const enqueueFiles = useCallback((files: readonly PlannedUploadFile[]) => {
    const known = new Set(
      uploadStore.getTasksSnapshot()
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
        ...(planned.relativePath !== planned.file.name
          ? { relativePath: planned.relativePath }
          : {}),
        ...(planned.skipExisting ? { skipExisting: true } : {}),
        status: "queued",
        uploadedBytes: 0,
      })
    }

    if (skipped) {
      toast.warning(`${skipped} duplicate upload${skipped === 1 ? "" : "s"} skipped`)
    }
    if (!additions.length) return

    uploadStore.add(additions)
    queue.current.push(...additions.map((task) => task.id))
    pumpRef.current()
  }, [])

  const prepareFiles = useCallback(async (
    folderId: string,
    files: readonly File[],
  ) => {
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

    patchTask(taskId, {
      status: "queued",
      uploadedBytes: task.sessionId ? task.uploadedBytes : 0,
      error: undefined,
    })

    queue.current.push(taskId)
    pumpRef.current()
  }, [patchTask, taskById])

  const cancel = useCallback(async (taskId: string) => {
    const task = taskById(taskId)
    if (!task) return

    if (task.status === "queued") {
      patchTask(taskId, { status: "cancelled" })
      return
    }

    if (
      !task.sessionId
      || task.status === "completed"
      || task.status === "skipped"
      || task.status === "cancelled"
      || task.status === "finalizing"
    ) return

    patchTask(taskId, {
      status: "cancelling",
      error: undefined,
    })
    controllers.current.get(taskId)?.abort(
      new DOMException("Upload cancelled", "AbortError"),
    )

    try {
      await apiJSON<void>(`/api/v1/uploads/${task.sessionId}`, {
        method: "DELETE",
      })
      patchTask(taskId, { status: "cancelled" })
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        router.replace("/login")
        router.refresh()
      }
      patchTask(taskId, {
        status: "error",
        error: uploadErrorMessage(error),
      })
    }
  }, [patchTask, router, taskById])

  const remove = useCallback((taskId: string) => {
    const task = taskById(taskId)
    if (!task) return

    if (
      !["completed", "skipped", "cancelled"].includes(task.status)
      && !(task.status === "error" && !task.sessionId)
    ) return

    uploadStore.remove(taskId)
  }, [taskById])

  const actions = useMemo(
    () => ({ addFiles, retry, cancel, remove }),
    [addFiles, cancel, remove, retry],
  )

  return (
    <UploadActionsContext.Provider value={actions}>
      {children}
    </UploadActionsContext.Provider>
  )
}

export function useUploadTasks() {
  return useSyncExternalStore(
    uploadStore.subscribeTasks,
    uploadStore.getTasksSnapshot,
    uploadStore.getServerTasksSnapshot,
  )
}

export function useUploadDockState() {
  return useSyncExternalStore(
    uploadStore.subscribeDock,
    uploadStore.getDockSnapshot,
    uploadStore.getServerDockSnapshot,
  )
}

export function useUploadActions() {
  const context = useContext(UploadActionsContext)
  if (!context) {
    throw new Error("useUploadActions must be used inside UploadProvider")
  }
  return context
}

export function useUploads() {
  const tasks = useUploadTasks()
  const actions = useUploadActions()
  return useMemo(() => ({ tasks, ...actions }), [actions, tasks])
}

function isActiveUploadStatus(status: UploadTaskStatus) {
  return status === "queued"
    || status === "preparing"
    || status === "uploading"
    || status === "finalizing"
    || status === "cancelling"
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof APIError) {
    return error.requestID
      ? `${error.message} · ${error.requestID}`
      : error.message
  }
  if (error instanceof Error && error.name !== "AbortError") return error.message
  return "Upload failed"
}
import { APIError } from "@discloud/api/types"

import { isFileAlreadyExistsError, planNativeUploadFiles, type PlannedNativeUploadFile } from "./folder"
import { beginNativeUploadTask, cancelNativeUploadTask, finishNativeUploadTask, inspectNativeUploadFiles, runNativeUploadTask } from "./native"
import { addUploadTasks, getUploadTask, getUploadTasksSnapshot, patchUploadTask, removeUploadTask, resetUploadStore, updateUploadProgress, type UploadTask } from "./upload-store"

export const uploadFileConcurrency = 3

type UploadEngineCallbacks = {
  onUnauthorized?: () => void
  onFolderChanged?: (folderId: string) => void
}

class DesktopUploadEngine {
  private callbacks: UploadEngineCallbacks = {}
  private queue: string[] = []
  private queueCursor = 0
  private activeFiles = 0
  private epoch = 0
  private enabled = false

  configure(callbacks: UploadEngineCallbacks) {
    this.callbacks = callbacks
    this.enabled = true
  }

  reset() {
    this.enabled = false
    this.epoch++

    for (const task of getUploadTasksSnapshot()) {
      if (isNativeActive(task)) void cancelNativeUploadTask(task.id, task.sessionId).catch(() => undefined)
    }

    this.queue = []
    this.queueCursor = 0
    this.activeFiles = 0
    this.callbacks = {}
    resetUploadStore()
  }

  async addPaths(folderId: string, paths: readonly string[]) {
    if (!this.enabled || !paths.length) return

    const epoch = this.epoch

    try {
      const files = await inspectNativeUploadFiles(paths)
      if (!this.enabled || epoch !== this.epoch) return

      const plan = await planNativeUploadFiles(folderId, files)
      if (!this.enabled || epoch !== this.epoch) return

      if (plan.createdFolders > 0) this.callbacks.onFolderChanged?.(folderId)
      this.enqueueFiles(plan.files)
    } catch (error) {
      if (!this.enabled || epoch !== this.epoch) return
      if (error instanceof APIError && error.status === 401) this.callbacks.onUnauthorized?.()
      throw error
    }
  }

  retry(taskId: string) {
    if (!this.enabled) return

    const task = getUploadTask(taskId)
    if (!task || task.status !== "error") return

    patchUploadTask(taskId, {
      status: "queued",
      uploadedBytes: task.sessionId ? task.uploadedBytes : 0,
      error: undefined,
    })

    this.queue.push(taskId)
    this.pump()
  }

  async cancel(taskId: string) {
    if (!this.enabled) return

    const task = getUploadTask(taskId)
    if (!task) return

    if (task.status === "queued") {
      patchUploadTask(taskId, { status: "cancelled", uploadedBytes: 0, error: undefined })
      return
    }

    if (["completed", "skipped", "cancelled", "finalizing", "cancelling"].includes(task.status)) return

    patchUploadTask(taskId, { status: "cancelling", error: undefined })

    try {
      await cancelNativeUploadTask(taskId, task.sessionId)
      patchUploadTask(taskId, { status: "cancelled", uploadedBytes: 0 })
    } catch (error) {
      if (error instanceof APIError && error.status === 401) this.callbacks.onUnauthorized?.()
      patchUploadTask(taskId, { status: "error", error: uploadErrorMessage(error) })
    }
  }

  remove(taskId: string) {
    const task = getUploadTask(taskId)
    if (!task) return

    if (task.status === "completed" || task.status === "skipped" || task.status === "cancelled" || task.status === "error" && !task.sessionId) {
      removeUploadTask(taskId)
    }
  }

  private enqueueFiles(files: readonly PlannedNativeUploadFile[]) {
    const known = new Set(
      getUploadTasksSnapshot()
        .filter((task) => !["completed", "skipped", "cancelled"].includes(task.status))
        .map((task) => `${task.folderId}\0${task.file.name}`),
    )
    const additions: UploadTask[] = []

    for (const planned of files) {
      const key = `${planned.folderId}\0${planned.file.name}`
      if (known.has(key)) continue

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

    if (!additions.length) return

    addUploadTasks(additions)
    this.queue.push(...additions.map((task) => task.id))
    this.pump()
  }

  private pump() {
    if (!this.enabled) return

    const epoch = this.epoch

    while (this.activeFiles < uploadFileConcurrency) {
      const task = this.takeQueuedTask()
      if (!task) return

      this.activeFiles++

      void this.execute(task, epoch).finally(() => {
        if (epoch !== this.epoch) return
        this.activeFiles = Math.max(0, this.activeFiles - 1)
        this.pump()
      })
    }
  }

  private takeQueuedTask() {
    while (this.queueCursor < this.queue.length) {
      const id = this.queue[this.queueCursor++]
      const task = getUploadTask(id)
      if (task?.status === "queued") return task
    }

    this.queue = []
    this.queueCursor = 0
    return undefined
  }

  private async execute(task: UploadTask, epoch: number) {
    let nativeStarted = false

    try {
      await beginNativeUploadTask(task.id)
      nativeStarted = true

      if (!this.enabled || epoch !== this.epoch) return

      const beforeStart = getUploadTask(task.id)
      if (!beforeStart || beforeStart.status === "cancelled" || beforeStart.status === "cancelling") {
        await cancelNativeUploadTask(task.id, beforeStart?.sessionId).catch(() => undefined)
        return
      }

      patchUploadTask(task.id, { status: "preparing", error: undefined })

      const result = await runNativeUploadTask({
        taskId: task.id,
        uploadId: task.sessionId,
        folderId: task.folderId,
        path: task.file.path,
        name: task.file.name,
        size: task.file.size,
      }, (event) => {
        if (!this.enabled || epoch !== this.epoch) return

        const current = getUploadTask(task.id)
        if (!current || current.status === "cancelling" || current.status === "cancelled") return

        if (event.status === "uploading") {
          if (current.status !== "uploading" || current.sessionId !== event.sessionId) {
            patchUploadTask(task.id, { sessionId: event.sessionId, status: "uploading" })
          }
          updateUploadProgress(task.id, event.uploadedBytes)
          return
        }

        patchUploadTask(task.id, { sessionId: event.sessionId, status: "finalizing", uploadedBytes: event.uploadedBytes })
      })

      if (!this.enabled || epoch !== this.epoch) return

      const current = getUploadTask(task.id)
      if (!current || current.status === "cancelling" || current.status === "cancelled") return

      patchUploadTask(task.id, {
        sessionId: result.sessionId,
        status: "completed",
        uploadedBytes: result.uploadedBytes,
      })
      this.callbacks.onFolderChanged?.(task.folderId)
    } catch (error) {
      if (!this.enabled || epoch !== this.epoch) return

      const current = getUploadTask(task.id)
      if (current?.status === "cancelling" || current?.status === "cancelled") return

      if (task.skipExisting && isFileAlreadyExistsError(error)) {
        patchUploadTask(task.id, { status: "skipped", uploadedBytes: 0, error: undefined })
        return
      }

      if (error instanceof APIError && error.status === 401) this.callbacks.onUnauthorized?.()
      patchUploadTask(task.id, { status: "error", error: uploadErrorMessage(error) })
    } finally {
      if (nativeStarted) await finishNativeUploadTask(task.id).catch(() => undefined)
    }
  }
}

export const uploadEngine = new DesktopUploadEngine()

function isNativeActive(task: UploadTask) {
  return ["preparing", "uploading", "finalizing", "cancelling"].includes(task.status)
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof APIError) return error.requestID ? `${error.message} · ${error.requestID}` : error.message
  if (error instanceof Error && error.message !== "Upload cancelled") return error.message
  return "Upload failed"
}

import type { CompletedFile, CreateUploadInput, UploadSession } from "@discloud/api/models"
import { APIError } from "@discloud/api/types"

import { apiJSON } from "#lib/api/transport"

import { beginNativeUploadTask, cancelNativeUploadTask, finishNativeUploadTask, inspectNativeUploadFiles, type NativeUploadFile, uploadNativePart } from "./native"
import { addUploadTasks, getUploadTask, getUploadTasksSnapshot, patchUploadTask, removeUploadTask, resetUploadStore, updateUploadProgress, type UploadTask } from "./upload-store"

export const uploadFileConcurrency = 3

type UploadEngineCallbacks = {
  onUnauthorized?: () => void
  onFolderChanged?: (folderId: string) => void
}

type UploadPartPlan = {
  index: number
  offset: number
  size: number
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
      if (isNativeActive(task)) void cancelNativeUploadTask(task.id).catch(() => undefined)
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
    const files = await inspectNativeUploadFiles(paths)

    if (!this.enabled || epoch !== this.epoch) return
    this.addFiles(folderId, files)
  }

  addFiles(folderId: string, files: readonly NativeUploadFile[]) {
    if (!this.enabled || !files.length) return

    const known = new Set(
      getUploadTasksSnapshot()
        .filter((task) => !["completed", "cancelled"].includes(task.status))
        .map((task) => `${task.folderId}\0${task.file.name}`),
    )

    const additions: UploadTask[] = []

    for (const file of files) {
      const key = `${folderId}\0${file.name}`
      if (known.has(key)) continue

      known.add(key)
      additions.push({
        id: crypto.randomUUID(),
        file,
        folderId,
        status: "queued",
        uploadedBytes: 0,
      })
    }

    if (!additions.length) return

    addUploadTasks(additions)
    this.queue.push(...additions.map((task) => task.id))
    this.pump()
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
      patchUploadTask(taskId, { status: "cancelled", error: undefined })
      return
    }

    if (task.status === "completed" || task.status === "cancelled" || task.status === "finalizing" || task.status === "cancelling") return

    patchUploadTask(taskId, { status: "cancelling", error: undefined })

    try {
      await cancelNativeUploadTask(taskId)

      if (task.sessionId) {
        await apiJSON<void>(`/api/v1/uploads/${encodeURIComponent(task.sessionId)}`, { method: "DELETE" })
        patchUploadTask(taskId, { status: "cancelled", uploadedBytes: 0 })
      }
    } catch (error) {
      if (error instanceof APIError && error.status === 401) this.callbacks.onUnauthorized?.()

      patchUploadTask(taskId, {
        status: "error",
        error: uploadErrorMessage(error),
      })
    }
  }

  remove(taskId: string) {
    const task = getUploadTask(taskId)
    if (!task) return

    if (task.status === "completed" || task.status === "cancelled" || task.status === "error" && !task.sessionId) {
      removeUploadTask(taskId)
    }
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
    if (!this.enabled || epoch !== this.epoch) return

    patchUploadTask(task.id, {
      status: "preparing",
      error: undefined,
    })

    let nativeStarted = false

    try {
      const session = task.sessionId
        ? await apiJSON<UploadSession>(`/api/v1/uploads/${encodeURIComponent(task.sessionId)}`)
        : await createSession(task)

      if (!this.enabled || epoch !== this.epoch) return

      patchUploadTask(task.id, {
        sessionId: session.id,
        status: "uploading",
      })

      if (getUploadTask(task.id)?.status === "cancelling") {
        await apiJSON<void>(`/api/v1/uploads/${encodeURIComponent(session.id)}`, { method: "DELETE" })
        patchUploadTask(task.id, { status: "cancelled", uploadedBytes: 0 })
        return
      }

      if (session.status === "completed") {
        patchUploadTask(task.id, {
          status: "completed",
          uploadedBytes: task.file.size,
        })
        this.callbacks.onFolderChanged?.(task.folderId)
        return
      }

      if (session.status !== "open") throw new Error(`Upload session is ${session.status}`)
      if (session.parentFolderId !== task.folderId || session.size !== task.file.size) {
        throw new Error("Upload session no longer matches this file")
      }

      const plan = planUploadParts(task.file.size, session.chunkSize)
      if (plan.length !== session.expectedParts) throw new Error("Upload session part count is inconsistent")

      const uploadedParts = new Set((session.parts ?? []).map((part) => part.partIndex))
      let uploadedBytes = (session.parts ?? []).reduce((total, part) => total + part.size, 0)

      updateUploadProgress(task.id, uploadedBytes)

      const missing = plan.filter((part) => !uploadedParts.has(part.index))

      if (missing.length) {
        await beginNativeUploadTask(task.id)
        nativeStarted = true

        const concurrency = normalizePartConcurrency(session.recommendedPartConcurrency)
        let cursor = 0

        async function worker() {
          while (cursor < missing.length) {
            const part = missing[cursor++]

            const result = await uploadNativePart({
              taskId: task.id,
              uploadId: session.id,
              path: task.file.path,
              partIndex: part.index,
              offset: part.offset,
              size: part.size,
            })

            uploadedBytes += result.size
            updateUploadProgress(task.id, uploadedBytes)
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()),
        )
      }

      if (getUploadTask(task.id)?.status === "cancelling") return

      patchUploadTask(task.id, { status: "finalizing" })

      await apiJSON<CompletedFile>(`/api/v1/uploads/${encodeURIComponent(session.id)}/complete`, {
        method: "POST",
      })

      if (!this.enabled || epoch !== this.epoch) return

      patchUploadTask(task.id, {
        status: "completed",
        uploadedBytes: task.file.size,
      })

      this.callbacks.onFolderChanged?.(task.folderId)
    } catch (error) {
      if (!this.enabled || epoch !== this.epoch) return

      const current = getUploadTask(task.id)

      if (current?.status === "cancelling") {
        if (!current.sessionId) patchUploadTask(task.id, { status: "cancelled", uploadedBytes: 0 })
        return
      }

      if (current?.status === "cancelled") return
      if (error instanceof APIError && error.status === 401) this.callbacks.onUnauthorized?.()

      patchUploadTask(task.id, {
        status: "error",
        error: uploadErrorMessage(error),
      })
    } finally {
      if (nativeStarted) await finishNativeUploadTask(task.id).catch(() => undefined)
    }
  }
}

export const uploadEngine = new DesktopUploadEngine()

async function createSession(task: UploadTask) {
  const input = {
    parentFolderId: task.folderId,
    name: task.file.name,
    size: task.file.size,
  } satisfies CreateUploadInput

  return apiJSON<UploadSession>("/api/v1/uploads", {
    method: "POST",
    body: input,
  })
}

function planUploadParts(size: number, chunkSize: number): UploadPartPlan[] {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid file size")
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("Invalid upload chunk size")
  if (size === 0) return []

  const parts: UploadPartPlan[] = []

  for (let offset = 0, index = 0; offset < size; offset += chunkSize, index++) {
    parts.push({
      index,
      offset,
      size: Math.min(chunkSize, size - offset),
    })
  }

  return parts
}

function normalizePartConcurrency(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

function isNativeActive(task: UploadTask) {
  return task.status === "uploading" || task.status === "cancelling"
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof APIError) {
    return error.requestID ? `${error.message} · ${error.requestID}` : error.message
  }

  if (error instanceof Error && error.message !== "Upload cancelled") return error.message
  return "Upload failed"
}
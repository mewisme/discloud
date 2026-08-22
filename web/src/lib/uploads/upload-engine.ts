import "client-only"

import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import { APIError } from "@/lib/api/types"
import { isFileAlreadyExistsError, type PlannedUploadFile, planUploadFiles } from "@/lib/uploads/folder"
import type { PendingThumbnail } from "@/lib/uploads/thumbnails"
import { generateUploadThumbnail, settleUploadThumbnail } from "@/lib/uploads/thumbnails"
import { uploadFile, uploadFileConcurrency, withUploadSlot } from "@/lib/uploads/upload"
import { addUploadTasks, getUploadTask, getUploadTasksSnapshot, patchUploadTask, removeUploadTask, resetUploadStore, updateUploadProgress, type UploadTask } from "@/lib/uploads/upload-store"

const progressPublishIntervalMs = 200

type UploadEngineCallbacks = {
  onUnauthorized?: () => void
  onFolderChanged?: (folderId: string) => void
}

class UploadEngine {
  private callbacks: UploadEngineCallbacks = {}
  private readonly controllers = new Map<string, AbortController>()
  private readonly pendingProgress = new Map<string, number>()
  private progressTimer: ReturnType<typeof setTimeout> | undefined
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
    this.controllers.forEach((controller) => controller.abort())
    this.controllers.clear()
    this.pendingProgress.clear()
    this.queue = []
    this.queueCursor = 0
    this.activeFiles = 0
    this.callbacks = {}

    if (this.progressTimer) {
      clearTimeout(this.progressTimer)
      this.progressTimer = undefined
    }

    resetUploadStore()
  }

  addFiles(folderId: string, files: readonly File[]) {
    if (!this.enabled || !files.length) return
    void this.prepareFiles(folderId, files, this.epoch)
  }

  retry(taskId: string) {
    if (!this.enabled) return

    const task = getUploadTask(taskId)
    if (!task || task.status !== "error") return

    this.patchTask(taskId, {
      status: "queued",
      uploadedBytes: task.sessionId ? task.uploadedBytes : 0,
      error: undefined,
    })

    this.queue.push(taskId)
    this.pump()
  }

  async cancel(taskId: string) {
    if (!this.enabled) return

    const epoch = this.epoch
    const task = getUploadTask(taskId)
    if (!task) return

    if (task.status === "queued") {
      this.patchTask(taskId, { status: "cancelled" })
      return
    }

    if (
      !task.sessionId
      || task.status === "completed"
      || task.status === "skipped"
      || task.status === "cancelled"
      || task.status === "finalizing"
    ) return

    this.patchTask(taskId, {
      status: "cancelling",
      error: undefined,
    })

    this.controllers.get(taskId)?.abort(
      new DOMException("Upload cancelled", "AbortError"),
    )

    try {
      await apiJSON<void>(`/api/v1/uploads/${task.sessionId}`, {
        method: "DELETE",
      })

      if (epoch !== this.epoch) return
      this.patchTask(taskId, { status: "cancelled" })
    } catch (error) {
      if (epoch !== this.epoch) return

      if (error instanceof APIError && error.status === 401) {
        this.callbacks.onUnauthorized?.()
      }

      this.patchTask(taskId, {
        status: "error",
        error: uploadErrorMessage(error),
      })
    }
  }

  remove(taskId: string) {
    const task = getUploadTask(taskId)
    if (!task) return

    const removable = task.status === "completed"
      || task.status === "skipped"
      || task.status === "cancelled"
      || task.status === "error" && !task.sessionId

    if (removable) removeUploadTask(taskId)
  }

  private async prepareFiles(
    folderId: string,
    files: readonly File[],
    epoch: number,
  ) {
    try {
      const plan = await planUploadFiles(folderId, files)
      if (epoch !== this.epoch || !this.enabled) return

      if (plan.createdFolders > 0) {
        this.callbacks.onFolderChanged?.(folderId)
      }

      this.enqueueFiles(plan.files)
    } catch (error) {
      if (epoch !== this.epoch) return

      if (error instanceof APIError && error.status === 401) {
        this.callbacks.onUnauthorized?.()
      }

      toast.error(uploadErrorMessage(error))
    }
  }

  private enqueueFiles(files: readonly PlannedUploadFile[]) {
    const known = new Set(
      getUploadTasksSnapshot()
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
      toast.warning(
        `${skipped} duplicate upload${skipped === 1 ? "" : "s"} skipped`,
      )
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

      void withUploadSlot(
        () => this.execute(task, epoch),
      ).finally(() => {
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
    if (epoch !== this.epoch) return

    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    this.patchTask(task.id, {
      status: "preparing",
      error: undefined,
    })

    let thumbnail: PendingThumbnail | undefined

    try {
      await uploadFile({
        file: task.file,
        folderId: task.folderId,
        sessionId: task.sessionId,
        signal: controller.signal,
        callbacks: {
          onSession: (sessionId) => {
            if (epoch !== this.epoch) return

            this.patchTask(task.id, {
              sessionId,
              status: "uploading",
            })

            thumbnail ??= generateUploadThumbnail(task.file)
          },
          onProgress: (uploadedBytes) => {
            if (epoch === this.epoch) {
              this.queueProgress(task.id, uploadedBytes)
            }
          },
          onFinalizing: () => {
            if (epoch === this.epoch) {
              this.patchTask(task.id, { status: "finalizing" })
            }
          },
          onCompleted: ({ id }) => {
            void settleUploadThumbnail(
              id,
              thumbnail,
              () => {
                if (epoch === this.epoch) {
                  this.callbacks.onFolderChanged?.(task.folderId)
                }
              },
            )
          },
        },
      })

      if (epoch !== this.epoch) return

      this.patchTask(task.id, {
        status: "completed",
        uploadedBytes: task.file.size,
      })

      this.callbacks.onFolderChanged?.(task.folderId)
    } catch (error) {
      if (epoch !== this.epoch) return

      const current = getUploadTask(task.id)

      if (
        current?.status === "cancelling"
        || current?.status === "cancelled"
      ) return

      if (task.skipExisting && isFileAlreadyExistsError(error)) {
        this.patchTask(task.id, {
          status: "skipped",
          uploadedBytes: 0,
          error: undefined,
        })
        return
      }

      if (error instanceof APIError && error.status === 401) {
        this.callbacks.onUnauthorized?.()
      }

      this.patchTask(task.id, {
        status: "error",
        error: uploadErrorMessage(error),
      })
    } finally {
      if (this.controllers.get(task.id) === controller) {
        this.controllers.delete(task.id)
      }
    }
  }

  private patchTask(id: string, patch: Partial<UploadTask>) {
    if (patch.status && patch.status !== "uploading") {
      this.pendingProgress.delete(id)
    }

    return patchUploadTask(id, patch)
  }

  private queueProgress(id: string, uploadedBytes: number) {
    this.pendingProgress.set(id, uploadedBytes)
    if (this.progressTimer) return

    this.progressTimer = setTimeout(() => {
      this.progressTimer = undefined

      if (!this.pendingProgress.size) return

      const updates = new Map(this.pendingProgress)
      this.pendingProgress.clear()
      updateUploadProgress(updates)
    }, progressPublishIntervalMs)
  }
}

export const uploadEngine = new UploadEngine()

function uploadErrorMessage(error: unknown) {
  if (error instanceof APIError) {
    return error.requestID
      ? `${error.message} · ${error.requestID}`
      : error.message
  }

  if (error instanceof Error && error.name !== "AbortError") {
    return error.message
  }

  return "Upload failed"
}
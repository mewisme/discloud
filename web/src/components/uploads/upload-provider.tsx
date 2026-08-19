"use client"

import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { apiJSON } from "@/lib/api/client"
import { APIError } from "@/lib/api/types"
import { uploadFile, withUploadSlot } from "@/lib/uploads/upload"

export const UPLOAD_COMPLETED_EVENT = "discloud:upload-completed"

export type UploadCompletedDetail = {
  folderId: string
}

export type UploadTaskStatus = "queued" | "preparing" | "uploading" | "finalizing" | "completed" | "error" | "cancelling" | "cancelled"

export type UploadTask = {
  id: string
  file: File
  folderId: string
  sessionId?: string
  status: UploadTaskStatus
  uploadedBytes: number
  error?: string
}

type UploadContextValue = {
  tasks: UploadTask[]
  addFiles: (folderId: string, files: readonly File[]) => void
  retry: (taskId: string) => void
  cancel: (taskId: string) => Promise<void>
  remove: (taskId: string) => void
}

const UploadContext = createContext<UploadContextValue | null>(null)

export function UploadProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const tasksRef = useRef<UploadTask[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort())
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  function patchTask(id: string, patch: Partial<UploadTask>) {
    const next = tasksRef.current.map((task) => task.id === id ? { ...task, ...patch } : task)
    tasksRef.current = next
    setTasks(next)
  }

  function taskById(id: string) {
    return tasksRef.current.find((task) => task.id === id)
  }

  function schedule(task: UploadTask) {
    void withUploadSlot(async () => {
      const current = taskById(task.id)
      if (!current || current.status !== "queued") return
      await execute(current)
    })
  }

  async function execute(task: UploadTask) {
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
          onProgress: (uploadedBytes) => patchTask(task.id, { uploadedBytes }),
          onFinalizing: () => patchTask(task.id, { status: "finalizing" }),
        },
      })

      patchTask(task.id, { status: "completed", uploadedBytes: task.file.size })
      notifyCompleted(task.folderId)
    } catch (error) {
      const current = taskById(task.id)
      if (current?.status === "cancelling" || current?.status === "cancelled") return

      if (error instanceof APIError && error.status === 401) {
        router.replace("/login")
        router.refresh()
      }

      patchTask(task.id, { status: "error", error: uploadErrorMessage(error) })
    } finally {
      controllers.current.delete(task.id)
    }
  }

  function addFiles(folderId: string, files: readonly File[]) {
    if (!files.length) return

    const known = new Set(tasksRef.current.filter((task) => task.status !== "completed" && task.status !== "cancelled").map((task) => `${task.folderId}\0${task.file.name}`))
    const additions: UploadTask[] = []
    let skipped = 0

    for (const file of files) {
      const key = `${folderId}\0${file.name}`
      if (known.has(key)) {
        skipped++
        continue
      }

      known.add(key)
      additions.push({
        id: crypto.randomUUID(),
        file,
        folderId,
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
  }

  function retry(taskId: string) {
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
  }

  async function cancel(taskId: string) {
    const task = taskById(taskId)
    if (!task) return

    if (task.status === "queued") {
      patchTask(taskId, { status: "cancelled" })
      return
    }
    if (!task.sessionId || task.status === "completed" || task.status === "cancelled" || task.status === "finalizing") return

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
  }

  function remove(taskId: string) {
    const task = taskById(taskId)
    if (!task) return
    if (task.status !== "completed" && task.status !== "cancelled" && !(task.status === "error" && !task.sessionId)) return

    const next = tasksRef.current.filter((item) => item.id !== taskId)
    tasksRef.current = next
    setTasks(next)
  }

  function notifyCompleted(folderId: string) {
    window.dispatchEvent(new CustomEvent<UploadCompletedDetail>(UPLOAD_COMPLETED_EVENT, { detail: { folderId } }))
    scheduleServerRefresh()
  }

  function scheduleServerRefresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => router.refresh(), 200)
  }

  return (
    <UploadContext.Provider value={{ tasks, addFiles, retry, cancel, remove }}>
      {children}
    </UploadContext.Provider>
  )
}

export function useUploads() {
  const context = useContext(UploadContext)
  if (!context) throw new Error("useUploads must be used inside UploadProvider")
  return context
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof APIError) return error.requestID ? `${error.message} · ${error.requestID}` : error.message
  if (error instanceof Error && error.name !== "AbortError") return error.message
  return "Upload failed"
}
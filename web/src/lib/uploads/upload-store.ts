import { useSyncExternalStore } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { createStore } from "zustand/vanilla"

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

type UploadStoreState = UploadDockState & {
  tasks: Map<string, UploadTask>
  order: string[]
  tasksVersion: number
  progressVersion: number
}

const activeIds = new Set<string>()
const uploadingIds = new Set<string>()
const finalizingIds = new Set<string>()
const failedIds = new Set<string>()
let lastFailedId: string | undefined
let cachedTasksVersion = -1
let cachedProgressVersion = -1
let cachedTasks: readonly UploadTask[] = []

const uploadStore = createStore<UploadStoreState>(() => ({
  tasks: new Map(),
  order: [],
  tasksVersion: 0,
  progressVersion: 0,
  activeCount: 0,
  failedCount: 0,
  completionVersion: 0,
}))

export function getUploadTask(id: string) {
  return uploadStore.getState().tasks.get(id)
}

export function getUploadTasksSnapshot(): readonly UploadTask[] {
  const state = uploadStore.getState()

  if (
    cachedTasksVersion === state.tasksVersion
    && cachedProgressVersion === state.progressVersion
  ) return cachedTasks

  const tasks: UploadTask[] = []

  for (const id of state.order) {
    const task = state.tasks.get(id)
    if (task) tasks.push(task)
  }

  cachedTasksVersion = state.tasksVersion
  cachedProgressVersion = state.progressVersion
  cachedTasks = tasks
  return tasks
}

export function getUploadDockSnapshot(): UploadDockState {
  const state = uploadStore.getState()

  return {
    activeCount: state.activeCount,
    failedCount: state.failedCount,
    currentTask: state.currentTask,
    completionVersion: state.completionVersion,
  }
}

export function addUploadTasks(additions: readonly UploadTask[]) {
  if (!additions.length) return

  const state = uploadStore.getState()
  const order = [...state.order]
  let added = 0

  for (const task of additions) {
    if (state.tasks.has(task.id)) continue

    state.tasks.set(task.id, task)
    order.push(task.id)
    updateStatusIndexes(task.id, undefined, task.status)
    added++
  }

  if (!added) return

  uploadStore.setState({
    order,
    tasksVersion: state.tasksVersion + 1,
    ...currentSummary(state.tasks),
  })
}

export function patchUploadTask(id: string, patch: Partial<UploadTask>) {
  const state = uploadStore.getState()
  const current = state.tasks.get(id)
  if (!current) return

  const next = { ...current, ...patch }
  state.tasks.set(id, next)

  const statusChanged = next.status !== current.status
  let completionVersion = state.completionVersion

  if (statusChanged) {
    updateStatusIndexes(id, current.status, next.status)

    if (
      next.status === "completed"
      && state.activeCount > 0
      && activeIds.size === 0
      && failedIds.size === 0
    ) {
      completionVersion++
    }
  }

  uploadStore.setState({
    tasksVersion: state.tasksVersion + 1,
    completionVersion,
    ...(statusChanged
      ? currentSummary(state.tasks)
      : state.currentTask?.id === id
        ? { currentTask: next }
        : {}),
  })

  return next
}

export function updateUploadProgress(updates: ReadonlyMap<string, number>) {
  if (!updates.size) return

  const state = uploadStore.getState()
  let changed = false
  let currentTask = state.currentTask

  for (const [id, uploadedBytes] of updates) {
    const task = state.tasks.get(id)
    if (!task || task.status !== "uploading") continue

    const nextUploaded = Math.max(task.uploadedBytes, uploadedBytes)
    if (nextUploaded === task.uploadedBytes) continue

    const next = { ...task, uploadedBytes: nextUploaded }
    state.tasks.set(id, next)
    changed = true

    if (currentTask?.id === id) currentTask = next
  }

  if (!changed) return

  uploadStore.setState({
    progressVersion: state.progressVersion + 1,
    currentTask,
  })
}

export function removeUploadTask(id: string) {
  const state = uploadStore.getState()
  const task = state.tasks.get(id)
  if (!task) return false

  updateStatusIndexes(id, task.status, undefined)
  state.tasks.delete(id)

  uploadStore.setState({
    order: state.order.filter((taskId) => taskId !== id),
    tasksVersion: state.tasksVersion + 1,
    ...currentSummary(state.tasks),
  })

  return true
}

export function resetUploadStore() {
  const state = uploadStore.getState()

  activeIds.clear()
  uploadingIds.clear()
  finalizingIds.clear()
  failedIds.clear()
  lastFailedId = undefined

  uploadStore.setState({
    tasks: new Map(),
    order: [],
    tasksVersion: state.tasksVersion + 1,
    progressVersion: state.progressVersion + 1,
    activeCount: 0,
    failedCount: 0,
    currentTask: undefined,
    completionVersion: 0,
  })
}

export function useUploadTasks() {
  return useSyncExternalStore(
    uploadStore.subscribe,
    getUploadTasksSnapshot,
    getUploadTasksSnapshot,
  )
}

export function useUploadDockState() {
  return useStore(
    uploadStore,
    useShallow((state) => ({
      activeCount: state.activeCount,
      failedCount: state.failedCount,
      currentTask: state.currentTask,
      completionVersion: state.completionVersion,
    })),
  )
}

function currentSummary(tasks: ReadonlyMap<string, UploadTask>) {
  const currentId = first(uploadingIds)
    ?? first(finalizingIds)
    ?? first(activeIds)
    ?? lastFailedId

  return {
    activeCount: activeIds.size,
    failedCount: failedIds.size,
    currentTask: currentId ? tasks.get(currentId) : undefined,
  }
}

function updateStatusIndexes(
  id: string,
  previous: UploadTaskStatus | undefined,
  next: UploadTaskStatus | undefined,
) {
  const wasActive = previous !== undefined && isActiveStatus(previous)
  const isActive = next !== undefined && isActiveStatus(next)

  if (!wasActive && isActive) activeIds.add(id)
  else if (wasActive && !isActive) activeIds.delete(id)

  updateStatusSet(uploadingIds, id, previous === "uploading", next === "uploading")
  updateStatusSet(finalizingIds, id, previous === "finalizing", next === "finalizing")

  const wasFailed = previous === "error"
  const isFailed = next === "error"

  if (!wasFailed && isFailed) {
    failedIds.add(id)
    lastFailedId = id
  } else if (wasFailed && !isFailed) {
    failedIds.delete(id)

    if (lastFailedId === id) {
      lastFailedId = last(failedIds)
    }
  }
}

function updateStatusSet(
  set: Set<string>,
  id: string,
  hadStatus: boolean,
  hasStatus: boolean,
) {
  if (!hadStatus && hasStatus) set.add(id)
  else if (hadStatus && !hasStatus) set.delete(id)
}

function isActiveStatus(status: UploadTaskStatus) {
  return status === "queued"
    || status === "preparing"
    || status === "uploading"
    || status === "finalizing"
    || status === "cancelling"
}

function first(values: ReadonlySet<string>) {
  return values.values().next().value as string | undefined
}

function last(values: ReadonlySet<string>) {
  let value: string | undefined
  for (const current of values) value = current
  return value
}
import { useSyncExternalStore } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { createStore } from "zustand/vanilla"

import type { NativeUploadRemovedEvent, NativeUploadSnapshot, NativeUploadTask, NativeUploadTaskEvent, NativeUploadTaskStatus } from "./native"

export type UploadTaskStatus = NativeUploadTaskStatus
export type UploadTask = NativeUploadTask

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
  baselineRevision: number
  latestRevision: number
  taskRevisions: Map<string, number>
  removedRevisions: Map<string, number>
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
  baselineRevision: -1,
  latestRevision: -1,
  taskRevisions: new Map(),
  removedRevisions: new Map(),
  activeCount: 0,
  failedCount: 0,
  completionVersion: 0,
}))

export function getUploadTasksSnapshot(): readonly UploadTask[] {
  const state = uploadStore.getState()

  if (cachedTasksVersion === state.tasksVersion && cachedProgressVersion === state.progressVersion) return cachedTasks

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

export function replaceUploadSnapshot(snapshot: NativeUploadSnapshot) {
  const state = uploadStore.getState()
  if (snapshot.revision < state.baselineRevision) return

  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const order = snapshot.tasks.map((task) => task.id)
  const orderSet = new Set(order)
  const taskRevisions = new Map<string, number>()
  const removedRevisions = new Map<string, number>()

  for (const [taskId, revision] of state.taskRevisions) {
    if (revision <= snapshot.revision) continue

    const task = state.tasks.get(taskId)
    if (!task) continue

    tasks.set(taskId, task)
    if (!orderSet.has(taskId)) {
      order.push(taskId)
      orderSet.add(taskId)
    }
    taskRevisions.set(taskId, revision)
  }

  for (const [taskId, revision] of state.removedRevisions) {
    if (revision <= snapshot.revision) continue

    tasks.delete(taskId)
    removedRevisions.set(taskId, revision)
  }

  const filteredOrder = order.filter((taskId) => tasks.has(taskId))
  rebuildStatusIndexes(filteredOrder, tasks)
  const hasNewerEvents = state.latestRevision > snapshot.revision

  uploadStore.setState({
    tasks,
    order: filteredOrder,
    tasksVersion: state.tasksVersion + 1,
    progressVersion: state.progressVersion + 1,
    baselineRevision: snapshot.revision,
    latestRevision: Math.max(state.latestRevision, snapshot.revision),
    taskRevisions,
    removedRevisions,
    completionVersion: hasNewerEvents ? Math.max(state.completionVersion, snapshot.completionVersion) : snapshot.completionVersion,
    ...currentSummary(tasks),
  })
}

export function applyUploadTaskEvent(event: NativeUploadTaskEvent) {
  const state = uploadStore.getState()
  if (event.revision <= state.baselineRevision) return

  const previousRevision = Math.max(state.taskRevisions.get(event.task.id) ?? -1, state.removedRevisions.get(event.task.id) ?? -1)
  if (event.revision <= previousRevision) return

  const current = state.tasks.get(event.task.id)
  const order = current ? state.order : [...state.order, event.task.id]
  const taskRevisions = new Map(state.taskRevisions)
  const removedRevisions = new Map(state.removedRevisions)

  if (current) updateStatusIndexes(event.task.id, current.status, event.task.status)
  else updateStatusIndexes(event.task.id, undefined, event.task.status)

  state.tasks.set(event.task.id, event.task)
  taskRevisions.set(event.task.id, event.revision)
  removedRevisions.delete(event.task.id)

  uploadStore.setState({
    order,
    tasksVersion: state.tasksVersion + 1,
    progressVersion: state.progressVersion + 1,
    latestRevision: Math.max(state.latestRevision, event.revision),
    taskRevisions,
    removedRevisions,
    completionVersion: Math.max(state.completionVersion, event.completionVersion),
    ...currentSummary(state.tasks),
  })
}

export function applyUploadRemovedEvent(event: NativeUploadRemovedEvent) {
  const state = uploadStore.getState()
  if (event.revision <= state.baselineRevision) return

  const previousRevision = Math.max(state.taskRevisions.get(event.taskId) ?? -1, state.removedRevisions.get(event.taskId) ?? -1)
  if (event.revision <= previousRevision) return

  const task = state.tasks.get(event.taskId)
  const taskRevisions = new Map(state.taskRevisions)
  const removedRevisions = new Map(state.removedRevisions)

  if (task) {
    updateStatusIndexes(event.taskId, task.status, undefined)
    state.tasks.delete(event.taskId)
  }

  taskRevisions.delete(event.taskId)
  removedRevisions.set(event.taskId, event.revision)

  uploadStore.setState({
    order: task ? state.order.filter((taskId) => taskId !== event.taskId) : state.order,
    tasksVersion: state.tasksVersion + (task ? 1 : 0),
    progressVersion: state.progressVersion + (task ? 1 : 0),
    latestRevision: Math.max(state.latestRevision, event.revision),
    taskRevisions,
    removedRevisions,
    completionVersion: Math.max(state.completionVersion, event.completionVersion),
    ...currentSummary(state.tasks),
  })
}

export function resetUploadProjection() {
  const state = uploadStore.getState()

  activeIds.clear()
  uploadingIds.clear()
  finalizingIds.clear()
  failedIds.clear()
  lastFailedId = undefined
  cachedTasksVersion = -1
  cachedProgressVersion = -1
  cachedTasks = []

  uploadStore.setState({
    tasks: new Map(),
    order: [],
    tasksVersion: state.tasksVersion + 1,
    progressVersion: state.progressVersion + 1,
    baselineRevision: -1,
    latestRevision: -1,
    taskRevisions: new Map(),
    removedRevisions: new Map(),
    activeCount: 0,
    failedCount: 0,
    currentTask: undefined,
    completionVersion: 0,
  })
}

export function useUploadTasks() {
  return useSyncExternalStore(uploadStore.subscribe, getUploadTasksSnapshot, getUploadTasksSnapshot)
}

export function useUploadDockState() {
  return useStore(uploadStore, useShallow((state) => ({
    activeCount: state.activeCount,
    failedCount: state.failedCount,
    currentTask: state.currentTask,
    completionVersion: state.completionVersion,
  })))
}

function rebuildStatusIndexes(order: readonly string[], tasks: ReadonlyMap<string, UploadTask>) {
  activeIds.clear()
  uploadingIds.clear()
  finalizingIds.clear()
  failedIds.clear()
  lastFailedId = undefined

  for (const taskId of order) {
    const task = tasks.get(taskId)
    if (task) updateStatusIndexes(taskId, undefined, task.status)
  }
}

function currentSummary(tasks: ReadonlyMap<string, UploadTask>) {
  const currentId = first(uploadingIds) ?? first(finalizingIds) ?? first(activeIds) ?? lastFailedId

  return {
    activeCount: activeIds.size,
    failedCount: failedIds.size,
    currentTask: currentId ? tasks.get(currentId) : undefined,
  }
}

function updateStatusIndexes(id: string, previous: UploadTaskStatus | undefined, next: UploadTaskStatus | undefined) {
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
    if (lastFailedId === id) lastFailedId = last(failedIds)
  }
}

function updateStatusSet(set: Set<string>, id: string, hadStatus: boolean, hasStatus: boolean) {
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

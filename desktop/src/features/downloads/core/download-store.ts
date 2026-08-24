import { useSyncExternalStore } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { createStore } from "zustand/vanilla"

import type { NativeDownloadRemovedEvent, NativeDownloadSnapshot, NativeDownloadTask, NativeDownloadTaskEvent, NativeDownloadTaskStatus } from "./native"

export type DownloadTaskStatus = NativeDownloadTaskStatus
export type DownloadTask = NativeDownloadTask

export type DownloadSummary = {
  activeCount: number
  failedCount: number
  currentTask?: DownloadTask
}

type DownloadStoreState = DownloadSummary & {
  tasks: Map<string, DownloadTask>
  order: string[]
  tasksVersion: number
  baselineRevision: number
  latestRevision: number
  taskRevisions: Map<string, number>
  removedRevisions: Map<string, number>
}

let cachedTasksVersion = -1
let cachedTasks: readonly DownloadTask[] = []

const downloadStore = createStore<DownloadStoreState>(() => ({
  tasks: new Map(),
  order: [],
  tasksVersion: 0,
  baselineRevision: -1,
  latestRevision: -1,
  taskRevisions: new Map(),
  removedRevisions: new Map(),
  activeCount: 0,
  failedCount: 0,
}))

export function getDownloadTasksSnapshot(): readonly DownloadTask[] {
  const state = downloadStore.getState()
  if (cachedTasksVersion === state.tasksVersion) return cachedTasks

  cachedTasks = state.order.flatMap((id) => {
    const task = state.tasks.get(id)
    return task ? [task] : []
  })
  cachedTasksVersion = state.tasksVersion
  return cachedTasks
}

export function replaceDownloadSnapshot(snapshot: NativeDownloadSnapshot) {
  const state = downloadStore.getState()
  if (snapshot.revision < state.baselineRevision) return

  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const order = snapshot.tasks.map((task) => task.id)
  const known = new Set(order)
  const taskRevisions = new Map<string, number>()
  const removedRevisions = new Map<string, number>()

  for (const [taskId, revision] of state.taskRevisions) {
    if (revision <= snapshot.revision) continue
    const task = state.tasks.get(taskId)
    if (!task) continue
    tasks.set(taskId, task)
    if (!known.has(taskId)) {
      order.push(taskId)
      known.add(taskId)
    }
    taskRevisions.set(taskId, revision)
  }

  for (const [taskId, revision] of state.removedRevisions) {
    if (revision <= snapshot.revision) continue
    tasks.delete(taskId)
    removedRevisions.set(taskId, revision)
  }

  const filteredOrder = order.filter((taskId) => tasks.has(taskId))
  downloadStore.setState({
    tasks,
    order: filteredOrder,
    tasksVersion: state.tasksVersion + 1,
    baselineRevision: snapshot.revision,
    latestRevision: Math.max(state.latestRevision, snapshot.revision),
    taskRevisions,
    removedRevisions,
    ...summary(filteredOrder, tasks),
  })
}

export function applyDownloadTaskEvent(event: NativeDownloadTaskEvent) {
  const state = downloadStore.getState()
  if (event.revision <= state.baselineRevision) return

  const previousRevision = Math.max(state.taskRevisions.get(event.task.id) ?? -1, state.removedRevisions.get(event.task.id) ?? -1)
  if (event.revision <= previousRevision) return

  const tasks = new Map(state.tasks)
  const current = tasks.get(event.task.id)
  tasks.set(event.task.id, event.task)
  const order = current ? state.order : [...state.order, event.task.id]
  const taskRevisions = new Map(state.taskRevisions)
  const removedRevisions = new Map(state.removedRevisions)
  taskRevisions.set(event.task.id, event.revision)
  removedRevisions.delete(event.task.id)

  downloadStore.setState({
    tasks,
    order,
    tasksVersion: state.tasksVersion + 1,
    latestRevision: Math.max(state.latestRevision, event.revision),
    taskRevisions,
    removedRevisions,
    ...summary(order, tasks),
  })
}

export function applyDownloadRemovedEvent(event: NativeDownloadRemovedEvent) {
  const state = downloadStore.getState()
  if (event.revision <= state.baselineRevision) return

  const previousRevision = Math.max(state.taskRevisions.get(event.taskId) ?? -1, state.removedRevisions.get(event.taskId) ?? -1)
  if (event.revision <= previousRevision) return

  const tasks = new Map(state.tasks)
  const existed = tasks.delete(event.taskId)
  const order = existed ? state.order.filter((taskId) => taskId !== event.taskId) : state.order
  const taskRevisions = new Map(state.taskRevisions)
  const removedRevisions = new Map(state.removedRevisions)
  taskRevisions.delete(event.taskId)
  removedRevisions.set(event.taskId, event.revision)

  downloadStore.setState({
    tasks,
    order,
    tasksVersion: state.tasksVersion + (existed ? 1 : 0),
    latestRevision: Math.max(state.latestRevision, event.revision),
    taskRevisions,
    removedRevisions,
    ...summary(order, tasks),
  })
}

export function resetDownloadProjection() {
  const state = downloadStore.getState()
  cachedTasksVersion = -1
  cachedTasks = []
  downloadStore.setState({
    tasks: new Map(),
    order: [],
    tasksVersion: state.tasksVersion + 1,
    baselineRevision: -1,
    latestRevision: -1,
    taskRevisions: new Map(),
    removedRevisions: new Map(),
    activeCount: 0,
    failedCount: 0,
    currentTask: undefined,
  })
}

export function useDownloadTasks() {
  return useSyncExternalStore(downloadStore.subscribe, getDownloadTasksSnapshot, getDownloadTasksSnapshot)
}

export function useDownloadSummary() {
  return useStore(downloadStore, useShallow((state) => ({ activeCount: state.activeCount, failedCount: state.failedCount, currentTask: state.currentTask })))
}

export function isActiveDownloadTask(task: DownloadTask) {
  return task.status === "queued" || task.status === "downloading" || task.status === "cancelling"
}

export function downloadTaskPercent(task: DownloadTask) {
  if (!task.totalBytes) return task.status === "completed" ? 100 : 0
  return Math.min(100, task.downloadedBytes / task.totalBytes * 100)
}

function summary(order: readonly string[], tasks: ReadonlyMap<string, DownloadTask>): DownloadSummary {
  let activeCount = 0
  let failedCount = 0
  let currentTask: DownloadTask | undefined

  for (const id of order) {
    const task = tasks.get(id)
    if (!task) continue
    if (isActiveDownloadTask(task)) {
      activeCount += 1
      currentTask = currentTask ?? task
    }
    if (task.status === "error") {
      failedCount += 1
      currentTask = currentTask ?? task
    }
  }

  return { activeCount, failedCount, currentTask }
}

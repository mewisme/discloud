import { beforeEach, describe, expect, it } from "vitest"

import { applyDownloadRemovedEvent, applyDownloadTaskEvent, getDownloadTasksSnapshot, replaceDownloadSnapshot, resetDownloadProjection } from "./download-store"
import type { NativeDownloadTask } from "./native"

function task(id: string, status: NativeDownloadTask["status"] = "queued"): NativeDownloadTask {
  return {
    id,
    fileName: id + ".txt",
    status,
    downloadedBytes: status === "downloading" ? 50 : 0,
    totalBytes: 100,
    canCancel: status === "queued" || status === "downloading",
    canRetry: status === "error" || status === "cancelled",
    canRemove: status === "completed" || status === "error" || status === "cancelled",
    canReveal: status === "completed",
  }
}

describe("download store projection", () => {
  beforeEach(() => resetDownloadProjection())

  it("ignores snapshots older than the current baseline", () => {
    replaceDownloadSnapshot({ tasks: [task("new")], revision: 5 })
    replaceDownloadSnapshot({ tasks: [task("stale")], revision: 4 })
    expect(getDownloadTasksSnapshot().map((item) => item.id)).toEqual(["new"])
  })

  it("preserves newer task events when a stale snapshot arrives later", () => {
    replaceDownloadSnapshot({ tasks: [task("file")], revision: 10 })
    applyDownloadTaskEvent({ task: task("file", "downloading"), revision: 11 })
    replaceDownloadSnapshot({ tasks: [task("file")], revision: 10 })
    expect(getDownloadTasksSnapshot()).toEqual([task("file", "downloading")])
  })

  it("keeps removal tombstones across stale snapshots", () => {
    replaceDownloadSnapshot({ tasks: [task("first"), task("second")], revision: 20 })
    applyDownloadRemovedEvent({ taskId: "first", revision: 22 })
    replaceDownloadSnapshot({ tasks: [task("first"), task("second")], revision: 21 })
    expect(getDownloadTasksSnapshot().map((item) => item.id)).toEqual(["second"])
  })

  it("allows a newer task event to supersede a removal tombstone", () => {
    replaceDownloadSnapshot({ tasks: [task("first"), task("second")], revision: 20 })
    applyDownloadRemovedEvent({ taskId: "first", revision: 22 })
    applyDownloadTaskEvent({ task: task("first", "queued"), revision: 23 })
    expect(getDownloadTasksSnapshot().map((item) => item.id)).toEqual(["second", "first"])
  })
})

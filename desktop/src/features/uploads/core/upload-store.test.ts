import { beforeEach, describe, expect, it } from "vitest"

import type { NativeUploadTask } from "./native"
import { applyUploadRemovedEvent, applyUploadTaskEvent, getUploadTasksSnapshot, replaceUploadSnapshot, resetUploadProjection } from "./upload-store"

function task(id: string, status: NativeUploadTask["status"] = "queued"): NativeUploadTask {
  return {
    id,
    file: { name: id + ".txt", size: 100 },
    folderId: "folder",
    status,
    uploadedBytes: status === "uploading" ? 50 : 0,
    canCancel: true,
    canRemove: false,
  }
}

describe("upload store projection", () => {
  beforeEach(() => resetUploadProjection())

  it("ignores snapshots older than the current baseline", () => {
    replaceUploadSnapshot({ tasks: [task("new")], completionVersion: 1, revision: 5 })
    replaceUploadSnapshot({ tasks: [task("stale")], completionVersion: 0, revision: 4 })
    expect(getUploadTasksSnapshot().map((item) => item.id)).toEqual(["new"])
  })

  it("preserves a newer task event when an older snapshot arrives later", () => {
    replaceUploadSnapshot({ tasks: [task("file")], completionVersion: 1, revision: 10 })
    applyUploadTaskEvent({ task: task("file", "uploading"), completionVersion: 1, revision: 11 })
    replaceUploadSnapshot({ tasks: [task("file", "queued")], completionVersion: 1, revision: 10 })

    expect(getUploadTasksSnapshot()).toEqual([task("file", "uploading")])
    applyUploadTaskEvent({ task: task("file", "queued"), completionVersion: 1, revision: 11 })
    expect(getUploadTasksSnapshot()).toEqual([task("file", "uploading")])
  })

  it("keeps a newer removal tombstone across stale snapshots and events", () => {
    replaceUploadSnapshot({ tasks: [task("first"), task("second")], completionVersion: 1, revision: 20 })
    applyUploadRemovedEvent({ taskId: "first", completionVersion: 1, revision: 22 })
    replaceUploadSnapshot({ tasks: [task("first"), task("second")], completionVersion: 1, revision: 21 })
    applyUploadTaskEvent({ task: task("first", "uploading"), completionVersion: 1, revision: 21 })

    expect(getUploadTasksSnapshot().map((item) => item.id)).toEqual(["second"])
  })

  it("allows a newer task event to supersede a removal tombstone", () => {
    replaceUploadSnapshot({ tasks: [task("first"), task("second")], completionVersion: 1, revision: 20 })
    applyUploadRemovedEvent({ taskId: "first", completionVersion: 1, revision: 22 })
    applyUploadTaskEvent({ task: task("first", "queued"), completionVersion: 1, revision: 23 })

    expect(getUploadTasksSnapshot().map((item) => item.id)).toEqual(["second", "first"])
  })
})

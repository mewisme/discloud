import { beforeEach, describe, expect, it } from "vitest"

import { addUploadTasks, getUploadDockSnapshot, getUploadTask, getUploadTasksSnapshot, patchUploadTask, resetUploadStore, updateUploadProgress, type UploadTask } from "@/lib/uploads/upload-store"

describe("upload store", () => {
  beforeEach(() => {
    resetUploadStore()
  })

  it("tracks a large queue without changing summary during unrelated progress", () => {
    const tasks = Array.from(
      { length: 1000 },
      (_, index) => createTask(
        `task-${index}`,
        "queued",
      ),
    )

    addUploadTasks(tasks)

    expect(
      getUploadDockSnapshot().activeCount,
    ).toBe(1000)

    patchUploadTask(
      "task-0",
      { status: "uploading" },
    )

    updateUploadProgress(
      new Map([
        ["task-0", 50],
      ]),
    )

    const dock = getUploadDockSnapshot()

    expect(dock.activeCount).toBe(1000)
    expect(dock.failedCount).toBe(0)
    expect(dock.currentTask?.id).toBe("task-0")
    expect(
      dock.currentTask?.uploadedBytes,
    ).toBe(50)

    expect(
      getUploadTask("task-999")?.status,
    ).toBe("queued")

    expect(
      getUploadTasksSnapshot(),
    ).toHaveLength(1000)
  })

  it("increments completion version only after the queue completes", () => {
    addUploadTasks([
      createTask("first", "queued"),
      createTask("second", "queued"),
    ])

    patchUploadTask(
      "first",
      { status: "uploading" },
    )
    patchUploadTask(
      "second",
      { status: "preparing" },
    )

    patchUploadTask(
      "first",
      {
        status: "completed",
        uploadedBytes: 100,
      },
    )

    expect(
      getUploadDockSnapshot().completionVersion,
    ).toBe(0)

    patchUploadTask(
      "second",
      { status: "uploading" },
    )
    patchUploadTask(
      "second",
      {
        status: "completed",
        uploadedBytes: 100,
      },
    )

    const dock = getUploadDockSnapshot()

    expect(dock.activeCount).toBe(0)
    expect(dock.failedCount).toBe(0)
    expect(dock.completionVersion).toBe(1)
  })

  it("prioritizes uploading tasks over queued tasks in the dock", () => {
    addUploadTasks([
      createTask("queued", "queued"),
      createTask("uploading", "queued"),
    ])

    patchUploadTask(
      "uploading",
      { status: "uploading" },
    )

    expect(
      getUploadDockSnapshot().currentTask?.id,
    ).toBe("uploading")
  })

  it("tracks failures independently from active uploads", () => {
    addUploadTasks([
      createTask("one", "queued"),
      createTask("two", "queued"),
    ])

    patchUploadTask(
      "one",
      {
        status: "error",
        error: "failed",
      },
    )

    const dock = getUploadDockSnapshot()

    expect(dock.activeCount).toBe(1)
    expect(dock.failedCount).toBe(1)
  })
})

function createTask(
  id: string,
  status: UploadTask["status"],
): UploadTask {
  return {
    id,
    file: {
      name: `${id}.bin`,
      size: 100,
      type: "application/octet-stream",
    } as File,
    folderId: "folder",
    status,
    uploadedBytes: 0,
  }
}
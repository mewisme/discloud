import { describe, expect, it } from "vitest"

import { collectionFilePath, collectionPath, fileBrowserPath, folderBrowserPath, folderBrowserURL, folderIdFromBrowserPath, workspacePath, workspaceRelativePath } from "@/lib/files/navigation"

describe("workspace navigation", () => {
  it("builds the workspace root", () => {
    expect(workspacePath("alice")).toBe("/alice")
    expect(folderBrowserPath("alice")).toBe("/alice")
  })

  it("builds canonical folder and file routes", () => {
    expect(folderBrowserPath("alice", "folder-123")).toBe("/alice/folders/folder-123")
    expect(fileBrowserPath("alice", "file-123")).toBe("/alice/files/file-123")
  })

  it("builds collection routes", () => {
    expect(collectionPath("alice")).toBe("/alice/collections")
    expect(collectionPath("alice", "collection-123")).toBe("/alice/collections/collection-123")
    expect(collectionFilePath("alice", "collection-123", "file-123")).toBe("/alice/collections/collection-123/files/file-123")
  })

  it("parses the workspace root as the Files root", () => {
    expect(folderIdFromBrowserPath("/alice", "alice")).toBeUndefined()
    expect(folderIdFromBrowserPath("/alice/", "alice")).toBeUndefined()
  })

  it("parses a canonical folder route", () => {
    expect(folderIdFromBrowserPath("/alice/folders/folder-123", "alice")).toBe("folder-123")
    expect(folderIdFromBrowserPath("/alice/folders/a%20b", "alice")).toBe("a b")
  })

  it("ignores routes that are not file-browser folders", () => {
    expect(folderIdFromBrowserPath("/alice/files/file-123", "alice")).toBeNull()
    expect(folderIdFromBrowserPath("/alice/search", "alice")).toBeNull()
    expect(folderIdFromBrowserPath("/alice/admin", "alice")).toBeNull()
    expect(folderIdFromBrowserPath("/bob/folders/folder-123", "alice")).toBeNull()
  })

  it("extracts the path relative to the active workspace", () => {
    expect(workspaceRelativePath("/alice", "alice")).toBe("/")
    expect(workspaceRelativePath("/alice/search", "alice")).toBe("/search")
    expect(workspaceRelativePath("/bob/search", "alice")).toBeNull()
  })

  it("preserves file-browser options", () => {
    expect(folderBrowserURL("alice", "abc", { view: "grid", sort: "updated", order: "desc" }))
      .toBe("/alice/folders/abc?view=grid&sort=updated&order=desc")
  })
})
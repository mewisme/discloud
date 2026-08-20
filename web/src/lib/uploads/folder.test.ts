import { describe, expect, it } from "vitest"

import { buildFolderUploadTree } from "@/lib/uploads/folder-tree"

describe("buildFolderUploadTree", () => {
  it("preserves nested folder structure", () => {
    const tree = buildFolderUploadTree([
      pathFile("a.jpg", "/Photos/2025/a.jpg"),
      pathFile("b.jpg", "/Photos/2025/b.jpg"),
      pathFile("c.jpg", "/Photos/2026/c.jpg"),
    ])

    expect(tree.folderPaths).toEqual([
      "Photos",
      "Photos/2025",
      "Photos/2026",
    ])

    expect(tree.entries.map((entry) => entry.relativePath)).toEqual([
      "Photos/2025/a.jpg",
      "Photos/2025/b.jpg",
      "Photos/2026/c.jpg",
    ])
  })

  it("keeps normal file uploads at the current folder", () => {
    const tree = buildFolderUploadTree([
      pathFile("a.txt", "/a.txt"),
      pathFile("b.txt", "/b.txt"),
    ])

    expect(tree.folderPaths).toEqual([])
    expect(tree.entries.map((entry) => entry.relativePath)).toEqual([
      "a.txt",
      "b.txt",
    ])
  })

  it("accepts react-dropzone paths for single and multi-file uploads", () => {
    const single = buildFolderUploadTree([
      pathFile("single.txt", "./single.txt"),
    ])

    expect(single.folderPaths).toEqual([])
    expect(single.entries.map((entry) => entry.relativePath)).toEqual([
      "single.txt",
    ])

    const multiple = buildFolderUploadTree([
      pathFile("a.txt", "./a.txt"),
      pathFile("b.txt", "./b.txt"),
    ])

    expect(multiple.folderPaths).toEqual([])
    expect(multiple.entries.map((entry) => entry.relativePath)).toEqual([
      "a.txt",
      "b.txt",
    ])
  })

  it("rejects parent traversal", () => {
    expect(() => buildFolderUploadTree([
      pathFile("evil.txt", "/Photos/../evil.txt"),
    ])).toThrow("Unsafe upload path")

    expect(() => buildFolderUploadTree([
      pathFile("evil.txt", "./../evil.txt"),
    ])).toThrow("Unsafe upload path")
  })
})

function pathFile(name: string, path: string) {
  return { name, path, webkitRelativePath: "" } as unknown as File
}
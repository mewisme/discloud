type PathAwareFile = File & {
  path?: string
}

export type FolderUploadEntry = {
  file: File
  relativePath: string
  directoryPath: string
}

export function buildFolderUploadTree(files: readonly File[]) {
  const entries = files.map(buildEntry)
  const folders = new Set<string>()

  for (const entry of entries) {
    if (!entry.directoryPath) continue
    const segments = entry.directoryPath.split("/")

    for (let index = 1; index <= segments.length; index++) {
      folders.add(segments.slice(0, index).join("/"))
    }
  }

  const folderPaths = [...folders].sort((left, right) => {
    const depth = folderDepth(left) - folderDepth(right)
    return depth || left.localeCompare(right)
  })

  return { entries, folderPaths }
}

function buildEntry(file: File): FolderUploadEntry {
  const pathAware = file as PathAwareFile
  const source = file.webkitRelativePath || pathAware.path || file.name
  let normalized = source.replaceAll("\\", "/").replace(/^\/+/, "")
  if (normalized.startsWith("./")) normalized = normalized.slice(2)

  const rawSegments = normalized.split("/")

  if (rawSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error(`Unsafe upload path: ${source}`)
  }

  const directorySegments = rawSegments.slice(0, -1).map(normalizeSegment)
  const fileName = normalizeSegment(file.name)
  const directoryPath = directorySegments.join("/")
  const relativePath = directoryPath ? `${directoryPath}/${fileName}` : fileName

  return { file, relativePath, directoryPath }
}

function normalizeSegment(value: string) {
  const segment = value.normalize("NFC").trim()

  if (!segment || segment === "." || segment === ".." || segment.includes("\0") || /[/\\]/.test(segment)) {
    throw new Error(`Unsafe upload path segment: ${value}`)
  }

  return segment
}

function folderDepth(path: string) {
  return path.split("/").length
}
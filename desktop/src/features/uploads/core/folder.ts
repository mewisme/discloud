import type { BatchFoldersInput, BatchFoldersResult } from "@discloud/api/models"
import { APIError } from "@discloud/api/types"

import { apiJSON } from "#lib/api/transport"

import type { NativeUploadFile } from "./native"

const MAX_BATCH_FOLDERS = 1000
const FILE_ALREADY_EXISTS_DETAIL = "file already exists"

type UploadEntry = {
  file: NativeUploadFile
  relativePath: string
  directoryPath: string
}

type FolderNode = {
  path: string
  parentPath: string
  name: string
  children: FolderNode[]
}

export type PlannedNativeUploadFile = {
  file: NativeUploadFile
  folderId: string
  relativePath: string
  skipExisting: boolean
}

export type NativeUploadPlan = {
  files: PlannedNativeUploadFile[]
  createdFolders: number
}

export async function planNativeUploadFiles(parentFolderId: string, files: readonly NativeUploadFile[]): Promise<NativeUploadPlan> {
  const tree = buildUploadTree(files)

  if (!tree.folderPaths.length) {
    return {
      files: tree.entries.map((entry) => ({
        file: entry.file,
        folderId: parentFolderId,
        relativePath: entry.relativePath,
        skipExisting: false,
      })),
      createdFolders: 0,
    }
  }

  const roots = buildFolderNodes(tree.folderPaths)
  const resolved = new Map<string, string>()
  const createdFolders = await resolveFolderForest(parentFolderId, roots, resolved)

  return {
    files: tree.entries.map((entry) => {
      const folderId = entry.directoryPath ? resolved.get(entry.directoryPath) : parentFolderId
      if (!folderId) throw new Error(`Could not resolve upload folder: ${entry.directoryPath}`)

      return {
        file: entry.file,
        folderId,
        relativePath: entry.relativePath,
        skipExisting: !!entry.directoryPath,
      }
    }),
    createdFolders,
  }
}

export function isFileAlreadyExistsError(error: unknown) {
  return error instanceof APIError
    && error.status === 409
    && error.problem?.detail === FILE_ALREADY_EXISTS_DETAIL
}

function buildUploadTree(files: readonly NativeUploadFile[]) {
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

function buildEntry(file: NativeUploadFile): UploadEntry {
  const source = file.relativePath.replaceAll("\\", "/").replace(/^\/+/, "")
  const rawSegments = source.split("/")

  if (rawSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error(`Unsafe upload path: ${file.relativePath}`)
  }

  const directorySegments = rawSegments.slice(0, -1).map(normalizeSegment)
  const relativeFileName = normalizeSegment(rawSegments.at(-1)!)
  const fileName = normalizeSegment(file.name)

  if (relativeFileName !== fileName) {
    throw new Error(`Upload path does not match file name: ${file.relativePath}`)
  }

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

function buildFolderNodes(paths: readonly string[]) {
  const nodes = new Map<string, FolderNode>()

  for (const path of paths) {
    const separator = path.lastIndexOf("/")
    const parentPath = separator === -1 ? "" : path.slice(0, separator)
    const name = separator === -1 ? path : path.slice(separator + 1)
    nodes.set(path, { path, parentPath, name, children: [] })
  }

  const roots: FolderNode[] = []

  for (const node of nodes.values()) {
    const parent = node.parentPath ? nodes.get(node.parentPath) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  for (const node of nodes.values()) node.children.sort((left, right) => left.path.localeCompare(right.path))
  roots.sort((left, right) => left.path.localeCompare(right.path))

  return roots
}

async function resolveFolderForest(parentFolderId: string, roots: readonly FolderNode[], resolved: Map<string, string>): Promise<number> {
  if (!roots.length) return 0

  const { selected, deferred } = takeFolderBatch(roots)
  const clientIds = new Map(selected.map((node, index) => [node.path, `folder-${index}`]))
  const input = {
    parentFolderId,
    folders: selected.map((node) => ({
      clientId: clientIds.get(node.path)!,
      ...(clientIds.has(node.parentPath) ? { parentClientId: clientIds.get(node.parentPath)! } : {}),
      name: node.name,
    })),
  } satisfies BatchFoldersInput

  const result = await apiJSON<BatchFoldersResult>("/api/v1/folders/batch", {
    method: "POST",
    body: input,
  })

  const pathByClientId = new Map([...clientIds].map(([path, clientId]) => [clientId, path]))
  let created = 0

  for (const folder of result.folders) {
    const path = pathByClientId.get(folder.clientId)
    if (!path) throw new Error(`Unexpected folder batch result: ${folder.clientId}`)

    resolved.set(path, folder.folderId)
    if (folder.created) created++
  }

  for (const [parentPath, children] of deferred) {
    const nextParentFolderId = parentPath ? resolved.get(parentPath) : parentFolderId
    if (!nextParentFolderId) throw new Error(`Could not resolve upload parent: ${parentPath}`)
    created += await resolveFolderForest(nextParentFolderId, children, resolved)
  }

  return created
}

function takeFolderBatch(roots: readonly FolderNode[]) {
  const selected: FolderNode[] = []
  const deferred = new Map<string, FolderNode[]>()

  function defer(parentPath: string, node: FolderNode) {
    const current = deferred.get(parentPath)
    if (current) current.push(node)
    else deferred.set(parentPath, [node])
  }

  function visit(node: FolderNode) {
    if (selected.length >= MAX_BATCH_FOLDERS) {
      defer(node.parentPath, node)
      return
    }

    selected.push(node)

    for (const child of node.children) {
      if (selected.length >= MAX_BATCH_FOLDERS) defer(node.path, child)
      else visit(child)
    }
  }

  for (const root of roots) visit(root)

  return { selected, deferred }
}

function folderDepth(path: string) {
  return path.split("/").length
}
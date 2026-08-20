export function workspacePath(username: string, suffix?: string) {
  const root = `/${encodeURIComponent(username)}`
  const normalized = suffix?.replace(/^\/+|\/+$/g, "")
  return normalized ? `${root}/${normalized}` : root
}

export function workspaceFolderPath(username: string, folderId: string) {
  return workspacePath(username, `folders/${encodeURIComponent(folderId)}`)
}

export function workspaceFilePath(username: string, fileId: string) {
  return workspacePath(username, `files/${encodeURIComponent(fileId)}`)
}

export function workspaceCollectionPath(username: string, collectionId: string) {
  return workspacePath(username, `collections/${encodeURIComponent(collectionId)}`)
}

export function workspaceCollectionFilePath(username: string, collectionId: string, fileId: string) {
  return workspacePath(username, `collections/${encodeURIComponent(collectionId)}/files/${encodeURIComponent(fileId)}`)
}

export function workspaceRelativePath(pathname: string, username: string) {
  const root = workspacePath(username)
  if (pathname === root || pathname === `${root}/`) return ""
  if (!pathname.startsWith(`${root}/`)) return null
  return pathname.slice(root.length + 1)
}
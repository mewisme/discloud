import { type BrowserOptions, browserURL } from "@/lib/files/browser"

export function workspacePath(username: string, suffix?: string) {
  const root = `/${encodeURIComponent(username)}`
  const rest = suffix?.replace(/^\/+|\/+$/g, "")
  return rest ? `${root}/${rest}` : root
}

export function folderBrowserPath(username: string, folderId?: string) {
  return folderId
    ? workspacePath(username, `folders/${encodeURIComponent(folderId)}`)
    : workspacePath(username)
}

export function folderBrowserURL(username: string, folderId: string | undefined, options: BrowserOptions) {
  return browserURL(folderBrowserPath(username, folderId), options)
}

export function fileBrowserPath(username: string, fileId: string) {
  return workspacePath(username, `files/${encodeURIComponent(fileId)}`)
}

export function collectionPath(username: string, collectionId?: string) {
  return collectionId
    ? workspacePath(username, `collections/${encodeURIComponent(collectionId)}`)
    : workspacePath(username, "collections")
}

export function collectionFilePath(username: string, collectionId: string, fileId: string) {
  return workspacePath(
    username,
    `collections/${encodeURIComponent(collectionId)}/files/${encodeURIComponent(fileId)}`,
  )
}

export function workspaceRelativePath(pathname: string, username: string) {
  const root = workspacePath(username)
  if (pathname === root || pathname === `${root}/`) return "/"
  if (!pathname.startsWith(`${root}/`)) return null
  return pathname.slice(root.length)
}

export function folderIdFromBrowserPath(pathname: string, username: string) {
  const relative = workspaceRelativePath(pathname, username)
  if (relative === "/") return undefined
  if (!relative) return null

  const match = /^\/folders\/([^/]+)\/?$/.exec(relative)
  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
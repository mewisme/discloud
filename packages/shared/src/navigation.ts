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

export function workspaceCollectionPath(username: string, collectionId?: string) {
  return collectionId
    ? workspacePath(username, `collections/${encodeURIComponent(collectionId)}`)
    : workspacePath(username, "collections")
}

export function workspaceCollectionFilePath(username: string, collectionId: string, fileId: string) {
  return workspacePath(username, `collections/${encodeURIComponent(collectionId)}/files/${encodeURIComponent(fileId)}`)
}

export function workspaceRelativePath(pathname: string, username: string) {
  const root = workspacePath(username)

  if (pathname === root || pathname === `${root}/`) return "/"
  if (!pathname.startsWith(`${root}/`)) return null

  return pathname.slice(root.length)
}

export function workspaceFolderIdFromPath(pathname: string, username: string) {
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

export function appRouteTitle(pathname: string, username: string) {
  const path = workspaceRelativePath(pathname, username)

  if (!path) return "DisCloud"
  if (path === "/" || path.startsWith("/folders/")) return "Files"
  if (path.startsWith("/files/")) return "File"
  if (path.startsWith("/uploads")) return "Uploads"
  if (path.startsWith("/admin/bots")) return "Bots"
  if (path.startsWith("/admin/diagnostics")) return "Diagnostics"
  if (path === "/admin" || path.startsWith("/admin/")) return "Admin"
  if (path.startsWith("/settings/profile")) return "Profile"
  if (path.startsWith("/settings/security")) return "Security"
  if (path.startsWith("/settings/common")) return "Common"
  if (path.startsWith("/settings/desktop")) return "Desktop"
  if (path === "/settings" || path.startsWith("/settings/")) return "Settings"
  if (path.startsWith("/collections")) return "Collections"
  if (path.startsWith("/favorites")) return "Favorites"
  if (path.startsWith("/shared")) return "Shared"
  if (path.startsWith("/search")) return "Search"
  if (path.startsWith("/trash")) return "Trash"

  return "DisCloud"
}

import { type BrowserOptions, browserURL } from "@/lib/files/browser"
import { workspaceCollectionFilePath, workspaceCollectionPath, workspaceFilePath, workspaceFolderIdFromPath, workspaceFolderPath, workspacePath } from "@/lib/workspace/navigation"

export { workspacePath, workspaceRelativePath } from "@/lib/workspace/navigation"

export function folderBrowserPath(username: string, folderId?: string) {
  return folderId ? workspaceFolderPath(username, folderId) : workspacePath(username)
}

export function folderBrowserURL(username: string, folderId: string | undefined, options: BrowserOptions) {
  return browserURL(folderBrowserPath(username, folderId), options)
}

export function fileBrowserPath(username: string, fileId: string) {
  return workspaceFilePath(username, fileId)
}

export function collectionPath(username: string, collectionId?: string) {
  return workspaceCollectionPath(username, collectionId)
}

export function collectionFilePath(username: string, collectionId: string, fileId: string) {
  return workspaceCollectionFilePath(username, collectionId, fileId)
}

export function folderIdFromBrowserPath(pathname: string, username: string) {
  return workspaceFolderIdFromPath(pathname, username)
}

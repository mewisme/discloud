import { type BrowserOptions,browserURL } from "@/lib/files/browser"

export function folderBrowserPath(folderId: string) {
  return `/files/${encodeURIComponent(folderId)}`
}

export function folderBrowserURL(folderId: string, options: BrowserOptions) {
  return browserURL(folderBrowserPath(folderId), options)
}

export function folderIdFromBrowserPath(pathname: string) {
  if (pathname === "/files" || pathname === "/files/") return undefined

  const match = /^\/files\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
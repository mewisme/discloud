export function publicSharePath(publicId: string) {
  return `/api/v1/public/shares/${encodeURIComponent(publicId)}`
}

export function publicShareUnlockPath(publicId: string) {
  return `${publicSharePath(publicId)}/unlock`
}

export function publicFileContentPath(publicId: string, fileId?: string) {
  const base = publicSharePath(publicId)
  return fileId ? `${base}/files/${encodeURIComponent(fileId)}/content` : `${base}/content`
}

export function publicFileDownloadPath(publicId: string, fileId?: string) {
  const base = publicSharePath(publicId)
  return fileId ? `${base}/files/${encodeURIComponent(fileId)}/download` : `${base}/download`
}

export function publicFolderPath(publicId: string, folderId: string) {
  return `${publicSharePath(publicId)}/folders/${encodeURIComponent(folderId)}`
}

export function publicFolderDownloadPath(publicId: string, folderId: string) {
  return `${publicFolderPath(publicId, folderId)}/download`
}
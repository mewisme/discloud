import type { FileVersion, FileVersionList } from "@discloud/api/models"
import { FileVersionHistory } from "@discloud/app-ui/files/file-version-history"
import { useEffect, useState } from "react"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { downloadNativeFileVersion } from "./native"

export function DesktopFileVersionHistory({ fileId, fileName, onRestored }: { fileId: string; fileName: string; onRestored?: () => void }) {
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [restoring, setRestoring] = useState<string>()

  async function load() { setLoading(true); setError(undefined); try { const result = await apiJSON<FileVersionList>(`/api/v1/files/${encodeURIComponent(fileId)}/versions`); setVersions([...result.versions]) } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [fileId])

  async function restore(version: FileVersion) { if (restoring) return; setRestoring(version.id); setError(undefined); try { await apiJSON<FileVersion>(`/api/v1/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.id)}/restore`, { method: "POST" }); await load(); onRestored?.() } catch (cause) { setError(errorMessage(cause)) } finally { setRestoring(undefined) } }
  async function download(version: FileVersion) { try { await downloadNativeFileVersion({ id: fileId, name: version.name || fileName }, version.id) } catch (cause) { setError(errorMessage(cause)) } }

  return <FileVersionHistory versions={versions} loading={loading} error={error} restoringVersionId={restoring} downloadHref={() => undefined} onDownload={download} onRestore={restore} />
}

"use client"

import type { FileVersion, FileVersionList } from "@discloud/api/models"
import { FileVersionHistory } from "@discloud/app-ui/files/file-version-history"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { apiJSON } from "@/lib/api/client"

export function WebFileVersionHistory({ fileId }: { fileId: string }) {
  const router = useRouter()
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [restoring, setRestoring] = useState<string>()

  async function load() {
    setLoading(true); setError(undefined)
    try { const result = await apiJSON<FileVersionList>(`/api/v1/files/${encodeURIComponent(fileId)}/versions`); setVersions([...result.versions]) }
    catch (cause) { setError(message(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [fileId])

  async function restore(version: FileVersion) {
    if (restoring) return
    setRestoring(version.id); setError(undefined)
    try { await apiJSON<FileVersion>(`/api/v1/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.id)}/restore`, { method: "POST" }); await load(); router.refresh() }
    catch (cause) { setError(message(cause)) }
    finally { setRestoring(undefined) }
  }

  return <FileVersionHistory versions={versions} loading={loading} error={error} restoringVersionId={restoring} downloadHref={(version) => `/api/backend/api/v1/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.id)}/download`} onRestore={restore} />
}

function message(error: unknown) { return error instanceof Error ? error.message : "Version action failed." }

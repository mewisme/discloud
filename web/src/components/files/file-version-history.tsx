"use client"

import type { FileVersion, FileVersionList } from "@discloud/api/models"
import { FileVersionHistory } from "@discloud/app-ui/files/file-version-history"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { apiJSON } from "@/lib/api/client"

export function WebFileVersionHistory({ fileId }: { fileId: string }) {
  const router = useRouter()
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [restoring, setRestoring] = useState<string>()
  const loadRequest = useRef(0)
  const restoreRequest = useRef(0)
  const operationController = useRef<AbortController | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++loadRequest.current
    setLoading(true); setError(undefined)
    try { const result = await apiJSON<FileVersionList>(`/api/v1/files/${encodeURIComponent(fileId)}/versions`, { signal }); if (!signal?.aborted && request === loadRequest.current) setVersions([...result.versions]) }
    catch (cause) { if (!signal?.aborted && request === loadRequest.current) setError(message(cause)) }
    finally { if (!signal?.aborted && request === loadRequest.current) setLoading(false) }
  }, [fileId])
  useEffect(() => {
    const controller = new AbortController()
    operationController.current = controller
    setRestoring(undefined)
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function restore(version: FileVersion) {
    if (restoring) return
    const request = ++restoreRequest.current
    const signal = operationController.current?.signal
    setRestoring(version.id); setError(undefined)
    try { await apiJSON<FileVersion>(`/api/v1/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.id)}/restore`, { method: "POST", signal }); if (signal?.aborted || request !== restoreRequest.current) return; await load(signal); if (!signal?.aborted && request === restoreRequest.current) router.refresh() }
    catch (cause) { if (!signal?.aborted && request === restoreRequest.current) setError(message(cause)) }
    finally { if (!signal?.aborted && request === restoreRequest.current) setRestoring(undefined) }
  }

  return <FileVersionHistory versions={versions} loading={loading} error={error} restoringVersionId={restoring} downloadHref={(version) => `/api/backend/api/v1/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.id)}/download`} onRestore={restore} />
}

function message(error: unknown) { return error instanceof Error ? error.message : "Version action failed." }

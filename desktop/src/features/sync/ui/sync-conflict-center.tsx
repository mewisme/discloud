import { formatBytes } from "@discloud/shared/format"
import { workspaceFilePath } from "@discloud/shared/navigation"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { ExternalLinkIcon, FolderOpenIcon, GitCompareArrowsIcon, Loader2Icon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"

import type { SyncConflictResolution } from "../core/types"
import { useDesktopSync } from "./sync-provider"

export function DesktopSyncConflictCenter() {
  const sync = useDesktopSync()
  const [resolving, setResolving] = useState<string>()
  const [error, setError] = useState<string>()

  async function resolve(pairId: string, conflictId: string, resolution: SyncConflictResolution) {
    if (resolving) return
    setResolving(conflictId)
    setError(undefined)
    try {
      await sync.resolveConflict(pairId, conflictId, resolution)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setResolving(undefined)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle className="flex items-center gap-2"><GitCompareArrowsIcon className="size-4" />Conflict Center</CardTitle><CardDescription>Resolve files changed on both sides before sync continues for those paths.</CardDescription></div>
          <Badge variant={sync.conflicts.length ? "destructive" : "outline"}>{sync.conflicts.length} pending</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {!sync.conflicts.length ? <p className="text-sm text-muted-foreground">No pending sync conflicts.</p> : sync.conflicts.map((conflict) => {
          const pair = sync.pairs.find((item) => item.id === conflict.pairId)
          if (!pair) return null
          const busy = resolving === conflict.id || sync.runtimes[conflict.pairId]?.status === "syncing"
          return (
            <div key={conflict.id} className="rounded-xl border p-3">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0"><p className="truncate font-medium" title={conflict.relativePath}>{conflict.relativePath}</p><p className="mt-0.5 text-xs text-muted-foreground">{pair.remoteFolderName} · local {formatBytes(conflict.localSize)} · remote {formatBytes(conflict.remoteSize)}</p></div>
                <Badge variant="outline" className="shrink-0">Conflict</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => void sync.openLocalPath(conflict.pairId, conflict.localPath).catch((cause) => setError(errorMessage(cause)))}><FolderOpenIcon />Open local</Button>
                <Button asChild size="sm" variant="ghost"><Link to={workspaceFilePath(pair.username, conflict.remoteFileId)}><ExternalLinkIcon />Open remote</Link></Button>
                <div className="hidden flex-1 sm:block" />
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve(pair.id, conflict.id, "keep-local")}>{busy && resolving === conflict.id ? <Loader2Icon className="animate-spin" /> : null}Keep local</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve(pair.id, conflict.id, "keep-remote")}>Keep remote</Button>
                <Button size="sm" disabled={busy} onClick={() => void resolve(pair.id, conflict.id, "keep-both")}>Keep both</Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Could not resolve sync conflict."
}

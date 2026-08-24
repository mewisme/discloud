import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Switch } from "@discloud/ui/components/switch"
import { FolderOpenIcon, FolderSyncIcon, Loader2Icon, PencilIcon, RefreshCwIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"

import type { SyncDirection, SyncPair, SyncPairRuntime, SyncRunResult } from "../core/types"
import { DesktopSyncConflictCenter } from "./sync-conflict-center"
import { DesktopSyncPairDialog, intervalLabel } from "./sync-pair-dialog"
import { useDesktopSync } from "./sync-provider"

export function DesktopSyncPage() {
  const sync = useDesktopSync()
  const [editing, setEditing] = useState<SyncPair>()
  const [actionError, setActionError] = useState<string>()
  const syncing = Object.values(sync.runtimes).some((runtime) => runtime.status === "syncing")

  async function remove(pair: SyncPair) {
    if (!window.confirm(`Remove sync for ${pair.localPath}? Local and remote files will not be deleted.`)) return
    setActionError(undefined)
    try {
      await sync.removePair(pair.id)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  async function reset(pair: SyncPair) {
    if (!window.confirm("Reset this sync baseline? The next run will compare both folders as a fresh pair and may create conflict copies.")) return
    setActionError(undefined)
    try {
      await sync.resetPairState(pair.id)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2"><FolderSyncIcon className="size-6" /><h1 className="text-2xl font-semibold tracking-tight">Sync</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Manage folders already paired from Files. Create new syncs from a folder&apos;s actions menu.</p>
        </div>
        <Button variant="outline" disabled={syncing || sync.pairs.length === 0} onClick={() => void sync.runAll()}><RefreshCwIcon className={syncing ? "animate-spin" : ""} />Sync all</Button>
      </div>

      {sync.error || actionError ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Sync configuration error</AlertTitle><AlertDescription>{actionError ?? sync.error}</AlertDescription></Alert> : null}

      <Alert>
        <FolderSyncIcon />
        <AlertTitle>Safe conflict handling</AlertTitle>
        <AlertDescription>Each local subtree and each DisCloud subtree can belong to only one sync pair. Overlapping roots are rejected before configuration is saved.</AlertDescription>
      </Alert>

      <DesktopSyncConflictCenter />

      {sync.loading ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><Loader2Icon className="size-4 animate-spin" />Loading sync pairs</span></div> : null}

      {!sync.loading && sync.pairs.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-56 flex-col items-center justify-center gap-4 text-center">
            <div className="grid size-12 place-items-center rounded-xl bg-muted"><FolderSyncIcon className="size-6" /></div>
            <div><p className="font-medium">No synced folders</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Open Files, use a folder&apos;s actions menu, then choose Sync. The current folder can also be synced from the folder actions menu in the toolbar.</p></div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {sync.pairs.map((pair) => {
          const runtime = sync.runtimes[pair.id]
          const busy = runtime?.status === "syncing"

          return (
            <Card key={pair.id}>
              <CardHeader>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2"><span className="truncate">{pair.remoteFolderName}</span><SyncStatusBadge pair={pair} runtime={runtime} /></CardTitle>
                    <CardDescription className="mt-1 break-all">{pair.localPath}</CardDescription>
                  </div>
                  <Switch checked={pair.enabled} disabled={busy} aria-label={`Enable sync for ${pair.remoteFolderName}`} onCheckedChange={(enabled) => void sync.updatePair(pair.id, { enabled }).catch((error) => setActionError(errorMessage(error)))} />
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <Detail label="Direction" value={directionLabel(pair.direction)} />
                  <Detail label="Schedule" value={`Every ${intervalLabel(pair.intervalSeconds)}`} />
                  <Detail label="Deletions" value={pair.deletePolicy === "propagate" ? "Propagate safely" : "Preserve"} />
                </div>

                {runtime?.error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Last sync failed</AlertTitle><AlertDescription>{runtime.error}</AlertDescription></Alert> : null}
                {runtime?.lastResult ? <ResultSummary result={runtime.lastResult} finishedAt={runtime.lastFinishedAt} /> : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="text-xs text-muted-foreground">{runtime?.nextRunAt && pair.enabled ? `Next automatic sync ${formatTime(runtime.nextRunAt)}` : pair.enabled ? "Waiting for automatic sync" : "Automatic sync paused"}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => void sync.openLocalPath(pair.id, pair.localPath).catch((error) => setActionError(errorMessage(error)))}><FolderOpenIcon />Open local folder</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reset(pair)}><RotateCcwIcon />Reset baseline</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(pair)}><PencilIcon />Edit settings</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(pair)}><Trash2Icon />Remove</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void sync.runPair(pair.id).catch((error) => setActionError(errorMessage(error)))}>{busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}Sync now</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {editing ? <DesktopSyncPairDialog pair={editing} open onOpenChange={(open) => { if (!open) setEditing(undefined) }} /> : null}
    </div>
  )
}

function SyncStatusBadge({ pair, runtime }: { pair: SyncPair; runtime?: SyncPairRuntime }) {
  if (!pair.enabled) return <Badge variant="outline">Paused</Badge>
  if (runtime?.status === "syncing") return <Badge variant="secondary">Syncing</Badge>
  if (runtime?.status === "error") return <Badge variant="destructive">Error</Badge>
  return <Badge variant="secondary">Active</Badge>
}

function ResultSummary({ result, finishedAt }: { result: SyncRunResult; finishedAt?: number }) {
  const changes = result.uploaded + result.downloaded + result.remoteDeleted + result.localDeleted + result.createdRemoteFolders + result.createdLocalFolders
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><span>{finishedAt ? `Synced ${formatTime(finishedAt)}` : "Last sync"}</span><span>{changes} change{changes === 1 ? "" : "s"}</span><span>{result.uploaded} uploaded</span><span>{result.downloaded} downloaded</span>{result.conflicts > 0 ? <span className="font-medium text-foreground">{result.conflicts} pending conflict{result.conflicts === 1 ? "" : "s"}</span> : null}</div>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate" title={value}>{value}</p></div>
}

function directionLabel(value: SyncDirection) {
  if (value === "download-only") return "Download only"
  if (value === "upload-only") return "Upload only"
  return "Two-way"
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Sync failed."
}

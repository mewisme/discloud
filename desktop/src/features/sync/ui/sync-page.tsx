import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Switch } from "@discloud/ui/components/switch"
import { Textarea } from "@discloud/ui/components/textarea"
import { FolderOpenIcon, FolderSyncIcon, Loader2Icon, PencilIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"

import { resolveSyncRemoteFolder } from "../core/api"
import { pickSyncFolder } from "../core/native"
import { defaultSyncIgnorePatterns, type SyncDeletePolicy, type SyncDirection, syncIntervalOptions, type SyncPair, type SyncPairRuntime, type SyncRunResult } from "../core/types"
import { useDesktopSync } from "./sync-provider"

export function DesktopSyncPage() {
  const sync = useDesktopSync()
  const [editing, setEditing] = useState<SyncPair | null | undefined>(undefined)
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
          <p className="mt-1 text-sm text-muted-foreground">Keep local folders and DisCloud folders synchronized while the desktop app is running, including in the tray.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={syncing || sync.pairs.length === 0} onClick={() => void sync.runAll()}><RefreshCwIcon className={syncing ? "animate-spin" : ""} />Sync all</Button>
          <Button onClick={() => setEditing(null)}><PlusIcon />New sync</Button>
        </div>
      </div>

      {sync.error || actionError ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Sync configuration error</AlertTitle><AlertDescription>{actionError ?? sync.error}</AlertDescription></Alert> : null}

      <Alert>
        <FolderSyncIcon />
        <AlertTitle>Safe conflict handling</AlertTitle>
        <AlertDescription>When both sides change the same file, DisCloud keeps both copies. Deletion propagation is off by default; when enabled, remote deletions move local files into <code>.discloud-trash</code> and local deletions move remote files into DisCloud Trash.</AlertDescription>
      </Alert>

      {sync.loading ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><Loader2Icon className="size-4 animate-spin" />Loading sync pairs</span></div> : null}

      {!sync.loading && sync.pairs.length === 0 ? (
        <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-4 text-center"><div className="grid size-12 place-items-center rounded-xl bg-muted"><FolderSyncIcon className="size-6" /></div><div><p className="font-medium">No synced folders</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Create a sync pair to connect a local directory with your Files root or another DisCloud folder.</p></div><Button onClick={() => setEditing(null)}><PlusIcon />Create sync pair</Button></CardContent></Card>
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
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Direction" value={directionLabel(pair.direction)} />
                  <Detail label="Remote folder" value={pair.remoteFolderId} mono />
                  <Detail label="Schedule" value={`Every ${intervalLabel(pair.intervalSeconds)}`} />
                  <Detail label="Deletions" value={pair.deletePolicy === "propagate" ? "Propagate safely" : "Preserve"} />
                </div>

                {runtime?.error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Last sync failed</AlertTitle><AlertDescription>{runtime.error}</AlertDescription></Alert> : null}
                {runtime?.lastResult ? <ResultSummary result={runtime.lastResult} finishedAt={runtime.lastFinishedAt} /> : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="text-xs text-muted-foreground">{runtime?.nextRunAt && pair.enabled ? `Next automatic sync ${formatTime(runtime.nextRunAt)}` : pair.enabled ? "Waiting for automatic sync" : "Automatic sync paused"}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reset(pair)}><RotateCcwIcon />Reset baseline</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(pair)}><PencilIcon />Edit</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(pair)}><Trash2Icon />Remove</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void sync.runPair(pair.id).catch((error) => setActionError(errorMessage(error)))}>{busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}Sync now</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {editing !== undefined ? <SyncPairDialog pair={editing ?? undefined} existingPairs={sync.pairs} onClose={() => setEditing(undefined)} /> : null}
    </div>
  )
}

function SyncPairDialog({ pair, existingPairs, onClose }: { pair?: SyncPair; existingPairs: readonly SyncPair[]; onClose: () => void }) {
  const sync = useDesktopSync()
  const [localPath, setLocalPath] = useState(pair?.localPath ?? "")
  const [remoteFolderId, setRemoteFolderId] = useState(pair?.remoteFolderId ?? "")
  const [direction, setDirection] = useState<SyncDirection>(pair?.direction ?? "two-way")
  const [deletePolicy, setDeletePolicy] = useState<SyncDeletePolicy>(pair?.deletePolicy ?? "preserve")
  const [intervalSeconds, setIntervalSeconds] = useState(pair?.intervalSeconds ?? 30)
  const [ignoreText, setIgnoreText] = useState((pair?.ignorePatterns ?? defaultSyncIgnorePatterns).join("\n"))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function chooseFolder() {
    try {
      const selected = await pickSyncFolder()
      if (selected) setLocalPath(selected)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function save() {
    const normalizedLocal = localPath.trim()
    if (!normalizedLocal) return setError("Choose a local folder.")
    setPending(true)
    setError(undefined)

    try {
      const remote = await resolveSyncRemoteFolder(remoteFolderId)
      const others = existingPairs.filter((item) => item.id !== pair?.id)
      if (others.some((item) => syncPathsOverlap(item.localPath, normalizedLocal))) throw new Error("This local folder overlaps another configured sync root.")
      if (others.some((item) => item.remoteFolderId === remote.id)) throw new Error("This DisCloud folder is already used by another sync pair on this account.")

      const input = {
        localPath: normalizedLocal,
        remoteFolderId: remote.id,
        remoteFolderName: remote.isRoot ? "Files" : remote.name,
        enabled: pair?.enabled ?? true,
        direction,
        deletePolicy,
        intervalSeconds,
        ignorePatterns: parseIgnorePatterns(ignoreText),
      }

      if (pair) {
        const locationChanged = pair.localPath !== input.localPath || pair.remoteFolderId !== input.remoteFolderId
        await sync.updatePair(pair.id, input)
        if (locationChanged) await sync.resetPairState(pair.id)
      } else {
        await sync.addPair(input)
      }
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{pair ? "Edit sync pair" : "New sync pair"}</DialogTitle><DialogDescription>Connect one local folder with a DisCloud folder. Leave the remote folder ID empty to sync your Files root.</DialogDescription></DialogHeader>
        <div className="grid gap-5 py-1">
          <label className="grid gap-2 text-sm font-medium">Local folder<div className="flex gap-2"><Input value={localPath} placeholder="Choose a folder" disabled={pending} readOnly /><Button type="button" variant="outline" disabled={pending} onClick={() => void chooseFolder()}><FolderOpenIcon />Browse</Button></div></label>
          <label className="grid gap-2 text-sm font-medium">Remote folder ID<Input value={remoteFolderId} placeholder="Empty = Files root" disabled={pending} onChange={(event) => setRemoteFolderId(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">Paste a folder UUID from DisCloud when syncing a subfolder.</span></label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">Direction<Select value={direction} disabled={pending} onValueChange={(value) => setDirection(value as SyncDirection)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="two-way">Two-way</SelectItem><SelectItem value="download-only">Download only</SelectItem><SelectItem value="upload-only">Upload only</SelectItem></SelectContent></Select></label>
            <label className="grid gap-2 text-sm font-medium">Deletions<Select value={deletePolicy} disabled={pending} onValueChange={(value) => setDeletePolicy(value as SyncDeletePolicy)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="preserve">Preserve</SelectItem><SelectItem value="propagate">Propagate safely</SelectItem></SelectContent></Select></label>
            <label className="grid gap-2 text-sm font-medium">Interval<Select value={String(intervalSeconds)} disabled={pending} onValueChange={(value) => setIntervalSeconds(Number(value))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{syncIntervalOptions.map((seconds) => <SelectItem key={seconds} value={String(seconds)}>{intervalLabel(seconds)}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <label className="grid gap-2 text-sm font-medium">Ignore rules<Textarea value={ignoreText} rows={7} spellCheck={false} disabled={pending} className="font-mono text-xs" onChange={(event) => setIgnoreText(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">One rule per line. Supports <code>*</code> and <code>?</code>; append <code>/</code> for directories. Internal sync trash/temp files are always ignored.</span></label>
          {deletePolicy === "propagate" ? <Alert><TriangleAlertIcon /><AlertTitle>Deletion propagation enabled</AlertTitle><AlertDescription>Local deletions send remote files to DisCloud Trash. Remote deletions move local files into the pair&apos;s <code>.discloud-trash</code> directory. Folder deletions are not propagated recursively.</AlertDescription></Alert> : null}
          {error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Could not save sync pair</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        </div>
        <DialogFooter><Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={() => void save()}>{pending ? <Loader2Icon className="animate-spin" /> : <FolderSyncIcon />}{pair ? "Save changes" : "Create sync"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><span>{finishedAt ? `Synced ${formatTime(finishedAt)}` : "Last sync"}</span><span>{changes} change{changes === 1 ? "" : "s"}</span><span>{result.uploaded} uploaded</span><span>{result.downloaded} downloaded</span>{result.conflicts > 0 ? <span className="font-medium text-foreground">{result.conflicts} conflict{result.conflicts === 1 ? "" : "s"} preserved</span> : null}</div>
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 truncate ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</p></div>
}

function parseIgnorePatterns(value: string) {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")))].slice(0, 256)
}

function directionLabel(value: SyncDirection) {
  if (value === "download-only") return "Download only"
  if (value === "upload-only") return "Upload only"
  return "Two-way"
}

function intervalLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${seconds / 60}m`
  return `${seconds / 3600}h`
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function syncPathsOverlap(left: string, right: string) {
  const a = normalizeSyncPath(left)
  const b = normalizeSyncPath(right)
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

function normalizeSyncPath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase()
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Sync action failed."
}

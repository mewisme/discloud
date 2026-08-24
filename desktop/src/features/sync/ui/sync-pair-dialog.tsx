import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Textarea } from "@discloud/ui/components/textarea"
import { FolderOpenIcon, FolderSyncIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { pickSyncFolder } from "../core/native"
import { defaultSyncIgnorePatterns, type SyncDeletePolicy, type SyncDirection, syncIntervalOptions, type SyncPair } from "../core/types"
import { useDesktopSync } from "./sync-provider"

export type SyncRemoteFolder = {
  id: string
  name: string
  accessLevel?: "view" | "edit" | "full"
}

export function DesktopSyncPairDialog({ pair, remoteFolder, open, onOpenChange }: { pair?: SyncPair; remoteFolder?: SyncRemoteFolder; open: boolean; onOpenChange: (open: boolean) => void }) {
  const sync = useDesktopSync()
  const readOnlyRemote = remoteFolder?.accessLevel === "view"
  const [localPath, setLocalPath] = useState(pair?.localPath ?? "")
  const [direction, setDirection] = useState<SyncDirection>(pair?.direction ?? (readOnlyRemote ? "download-only" : "two-way"))
  const [deletePolicy, setDeletePolicy] = useState<SyncDeletePolicy>(pair?.deletePolicy ?? (readOnlyRemote ? "preserve" : "propagate"))
  const [intervalSeconds, setIntervalSeconds] = useState(pair?.intervalSeconds ?? 30)
  const [ignoreText, setIgnoreText] = useState((pair?.ignorePatterns ?? defaultSyncIgnorePatterns).join("\n"))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const remoteName = remoteFolder?.name ?? pair?.remoteFolderName ?? "Folder"

  useEffect(() => {
    if (!open) return
    setLocalPath(pair?.localPath ?? "")
    setDirection(pair?.direction ?? (readOnlyRemote ? "download-only" : "two-way"))
    setDeletePolicy(pair?.deletePolicy ?? (readOnlyRemote ? "preserve" : "propagate"))
    setIntervalSeconds(pair?.intervalSeconds ?? 30)
    setIgnoreText((pair?.ignorePatterns ?? defaultSyncIgnorePatterns).join("\n"))
    setError(undefined)
  }, [open, pair, readOnlyRemote])

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
    if (!pair && !normalizedLocal) return setError("Choose a local folder.")
    if (!pair && !remoteFolder) return setError("Remote folder is missing.")

    setPending(true)
    setError(undefined)

    try {
      const behavior = { direction, deletePolicy, intervalSeconds, ignorePatterns: parseIgnorePatterns(ignoreText) }
      if (pair) {
        await sync.updatePair(pair.id, { ...behavior, ...(remoteFolder ? { remoteFolderName: remoteFolder.name } : {}) })
      } else {
        await sync.addPair({
          ...behavior,
          localPath: normalizedLocal,
          remoteFolderId: remoteFolder!.id,
          remoteFolderName: remoteFolder!.name,
          enabled: true,
        })
      }
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen) }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{pair ? `Sync settings for ${remoteName}` : `Sync ${remoteName}`}</DialogTitle>
          <DialogDescription>{pair ? "Change how this pair syncs. Remote and local roots stay fixed to protect the existing baseline." : "Connect this DisCloud folder with one local folder."}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          <div className="grid gap-1.5 text-sm">
            <span className="font-medium">Remote folder</span>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{remoteName}</div>
          </div>

          <label className="grid gap-2 text-sm font-medium">
            Local folder
            <div className="flex gap-2">
              <Input value={localPath} placeholder="Choose a folder" disabled={pending} readOnly />
              {!pair ? <Button type="button" variant="outline" disabled={pending} onClick={() => void chooseFolder()}><FolderOpenIcon />Browse</Button> : null}
            </div>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">
              Direction
              <Select value={direction} disabled={pending} onValueChange={(value) => { const next = value as SyncDirection; setDirection(next); if (next === "two-way") setDeletePolicy("propagate") }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="two-way" disabled={readOnlyRemote}>Two-way</SelectItem>
                  <SelectItem value="download-only">Download only</SelectItem>
                  <SelectItem value="upload-only" disabled={readOnlyRemote}>Upload only</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Deletions
              <Select value={direction === "two-way" ? "propagate" : deletePolicy} disabled={pending || direction === "two-way"} onValueChange={(value) => setDeletePolicy(value as SyncDeletePolicy)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="preserve">Preserve</SelectItem>
                  <SelectItem value="propagate">Propagate safely</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Interval
              <Select value={String(intervalSeconds)} disabled={pending} onValueChange={(value) => setIntervalSeconds(Number(value))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{syncIntervalOptions.map((seconds) => <SelectItem key={seconds} value={String(seconds)}>{intervalLabel(seconds)}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>

          <label className="grid gap-2 text-sm font-medium">
            Ignore rules
            <Textarea value={ignoreText} rows={6} spellCheck={false} disabled={pending} className="font-mono text-xs" onChange={(event) => setIgnoreText(event.target.value)} />
            <span className="text-xs font-normal text-muted-foreground">One rule per line. Supports <code>*</code> and <code>?</code>; append <code>/</code> for directories.</span>
          </label>

          {readOnlyRemote ? <Alert><TriangleAlertIcon /><AlertTitle>Read-only remote folder</AlertTitle><AlertDescription>This folder can only use download-only sync.</AlertDescription></Alert> : null}
          {direction === "two-way" || deletePolicy === "propagate" ? <Alert><TriangleAlertIcon /><AlertTitle>Deletion propagation enabled</AlertTitle><AlertDescription>Two-way sync mirrors deletions. Local deletions send remote files and folders to DisCloud Trash; remote deletions move local files and folders into <code>.discloud-trash</code>.</AlertDescription></Alert> : <Alert><TriangleAlertIcon /><AlertTitle>Deleted items are preserved</AlertTitle><AlertDescription>Deleting an item on one side can recreate it from the other side on the next sync.</AlertDescription></Alert>}
          {error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Could not save sync pair</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void save()}>{pending ? <Loader2Icon className="animate-spin" /> : <FolderSyncIcon />}{pair ? "Save settings" : "Start sync"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function intervalLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${seconds / 60}m`
  return `${seconds / 3600}h`
}

function parseIgnorePatterns(value: string) {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")))].slice(0, 256)
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Sync failed."
}

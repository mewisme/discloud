import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { BugIcon, DownloadIcon, FolderOpenIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { clearDesktopLogs, type DesktopDiagnostics,exportDesktopLogs, loadDesktopDiagnostics, openDesktopLogFolder } from "../core/diagnostics"

export function DesktopDiagnosticsSettings() {
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics>()
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()

  const reload = useCallback(async () => {
    setError(undefined)
    try {
      setDiagnostics(await loadDesktopDiagnostics())
    } catch (error) {
      setError(errorMessage(error, "Could not load desktop diagnostics."))
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  async function run(key: string, action: () => Promise<void>, refresh = false) {
    if (pending) return
    setPending(key)
    setError(undefined)
    try {
      await action()
      if (refresh) await reload()
    } catch (error) {
      setError(errorMessage(error, "Desktop diagnostics action failed."))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BugIcon className="size-4" />Diagnostics and logs</CardTitle>
        <CardDescription>Inspect and export persistent native logs when desktop integrations or transfers fail.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Diagnostics unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{diagnostics?.files.length ?? 0} files</Badge>
          <Badge variant="secondary">{formatBytes(diagnostics?.totalSize ?? 0)}</Badge>
          {pending === "refresh" && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="rounded-xl border p-4">
          <p className="text-sm font-medium">Log directory</p>
          <code className="mt-1 block break-all text-xs text-muted-foreground">{diagnostics?.directory ?? "Loading..."}</code>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!pending} onClick={() => void run("refresh", reload)}>
            {pending === "refresh" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}Refresh
          </Button>
          <Button size="sm" variant="outline" disabled={!!pending} onClick={() => void run("open", openDesktopLogFolder)}><FolderOpenIcon />Open folder</Button>
          <Button size="sm" variant="outline" disabled={!!pending} onClick={() => void run("export", async () => { await exportDesktopLogs() })}><DownloadIcon />Export logs</Button>
          <Button size="sm" variant="destructive" disabled={!!pending} onClick={() => void run("clear", clearDesktopLogs, true)}><Trash2Icon />Clear logs</Button>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Latest log tail</p>
            <span className="text-xs text-muted-foreground">Last 64 KiB</span>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border bg-muted/30 p-3 font-mono text-xs">{diagnostics?.tail || "No desktop logs yet."}</pre>
        </div>

        <p className="text-xs text-muted-foreground">Diagnostics may include file IDs, transfer metadata and local paths. Credential values and signed CDN URLs are not written by these hooks.</p>
      </CardContent>
    </Card>
  )
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message
  return fallback
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B"
  const units = ["KiB", "MiB", "GiB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return value.toFixed(value >= 10 ? 1 : 2) + " " + units[unit]
}

"use client"

import type { FileVersion } from "@discloud/api/models"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { DownloadIcon, HistoryIcon, Loader2Icon, RotateCcwIcon } from "lucide-react"

export function FileVersionHistory({ versions, loading = false, error, restoringVersionId, downloadHref, onDownload, onRestore }: { versions: readonly FileVersion[]; loading?: boolean; error?: string; restoringVersionId?: string; downloadHref: (version: FileVersion) => string | undefined; onDownload?: (version: FileVersion) => void | Promise<void>; onRestore?: (version: FileVersion) => void | Promise<void> }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HistoryIcon className="size-4" />Version history</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Loading versions</div> : null}
        {!loading && versions.length === 0 ? <p className="text-sm text-muted-foreground">No versions available.</p> : null}
        {versions.map((version) => {
          const href = downloadHref(version)
          const restoring = restoringVersionId === version.id
          return <div key={version.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Revision {version.revision}</span>{version.isCurrent ? <Badge variant="secondary">Current</Badge> : null}{version.restoredFromVersionId ? <Badge variant="outline">Restored</Badge> : null}</div>
              <div className="text-xs text-muted-foreground">{formatDate(version.createdAt)} · {formatBytes(version.size)} · {version.mimeType}</div>
              {version.sha256 ? <code className="block max-w-xl truncate font-mono text-[11px] text-muted-foreground" title={version.sha256}>{version.sha256}</code> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              {href ? <Button size="sm" variant="outline" asChild><a href={href}><DownloadIcon />Download</a></Button> : onDownload ? <Button size="sm" variant="outline" onClick={() => void onDownload(version)}><DownloadIcon />Download</Button> : null}
              {!version.isCurrent && onRestore ? <Button size="sm" variant="outline" disabled={!!restoringVersionId} onClick={() => void onRestore(version)}>{restoring ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}{restoring ? "Restoring" : "Restore"}</Button> : null}
            </div>
          </div>
        })}
      </CardContent>
    </Card>
  )
}

import type { StorageAnalyzerSnapshot } from "@discloud/api/models"
import { formatBytes, formatDate, formatNumber } from "@discloud/shared/format"
import { workspaceFilePath, workspacePath } from "@discloud/shared/navigation"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { CopyIcon, DatabaseIcon, FilesIcon, HardDriveIcon, HistoryIcon, Trash2Icon } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

export type StorageLinkRenderer = (props: { href: string; className?: string; children: ReactNode }) => ReactElement

export function StorageAnalyzerView({ username, data, renderLink }: { username: string; data: StorageAnalyzerSnapshot; renderLink: StorageLinkRenderer }) {
  const largestHref = searchHref(username, { kind: "file", sort: "size", order: "desc" })
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-sm text-muted-foreground">Understand how storage is used in @{username}&apos;s workspace.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={HardDriveIcon} title="Logical storage" value={formatBytes(data.summary.logicalBytes)} description={formatNumber(data.summary.fileCount) + " active files"} />
        <SummaryCard icon={DatabaseIcon} title="Referenced chunks" value={formatBytes(data.summary.referencedChunkBytes)} description="Unique chunks referenced by current files, trash, and versions." />
        <SummaryCard icon={Trash2Icon} title="Trash" value={formatBytes(data.summary.trashBytes)} description={formatNumber(data.summary.trashFileCount) + " trashed files"} action={renderLink({ href: workspacePath(username, "trash"), children: "Review trash" })} />
        <SummaryCard icon={HistoryIcon} title="Version history" value={formatBytes(data.summary.versionBytes)} description="Previous revisions retained across the workspace." />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Usage by category</CardTitle><CardDescription>Logical size of active files.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {data.categories.length === 0 ? <Empty label="No files to analyze." /> : data.categories.map((item) => {
              const percent = data.summary.logicalBytes > 0 ? item.bytes / data.summary.logicalBytes * 100 : 0
              return (
                <div key={item.category} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    {renderLink({ href: searchHref(username, { kind: "file", category: item.category, sort: "size", order: "desc" }), className: "min-w-0 truncate font-medium capitalize hover:underline", children: item.category })}
                    <span className="shrink-0 text-muted-foreground">{formatBytes(item.bytes)} · {formatNumber(item.fileCount)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: String(Math.max(0, Math.min(100, percent))) + "%" }} /></div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Largest files</CardTitle><CardDescription>Largest active files by logical size.</CardDescription></div><Button size="sm" variant="outline" asChild>{renderLink({ href: largestHref, children: "View all" })}</Button></CardHeader>
          <CardContent>{data.largest.length === 0 ? <Empty label="No files to analyze." /> : <FileRows username={username} files={data.largest} renderLink={renderLink} />}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Old files</CardTitle><CardDescription>Content unchanged for at least {data.oldFiles.thresholdDays} days · {formatNumber(data.oldFiles.totalFiles)} files · {formatBytes(data.oldFiles.totalBytes)}.</CardDescription></CardHeader>
          <CardContent>{data.oldFiles.items.length === 0 ? <Empty label={"No files have been unchanged for " + data.oldFiles.thresholdDays + "+ days."} /> : <FileRows username={username} files={data.oldFiles.items} renderLink={renderLink} showDate />}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Duplicate files</CardTitle><CardDescription>{formatNumber(data.duplicates.groupCount)} groups · {formatBytes(data.duplicates.totalDuplicateLogicalBytes)} duplicated logically. Chunk deduplication means this is not physical reclaimable space.</CardDescription></CardHeader>
          <CardContent className="space-y-1">{data.duplicates.items.length === 0 ? <Empty label="No exact SHA-256 duplicate groups found." /> : data.duplicates.items.map((group) => (
            <div key={group.sha256 + ":" + group.sizeBytes} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
              <CopyIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {renderLink({ href: workspaceFilePath(username, group.sampleFileId), className: "block truncate text-sm font-medium hover:underline", children: group.sampleName })}
                <p className="truncate text-xs text-muted-foreground">{formatNumber(group.fileCount)} copies · {formatBytes(group.sizeBytes)} each · {group.sha256.slice(0, 12)}…</p>
              </div>
              <Badge variant="secondary" className="shrink-0">{formatBytes(group.duplicateLogicalBytes)}</Badge>
            </div>
          ))}</CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">Referenced chunks counts unique chunks used by file versions in this workspace, including trashed files. Chunks can also be referenced by other files or workspaces, so it is intentionally not labeled reclaimable physical storage.</p>
    </div>
  )
}

function SummaryCard({ icon: Icon, title, value, description, action }: { icon: typeof FilesIcon; title: string; value: string; description: string; action?: ReactNode }) {
  return <Card><CardHeader className="pb-2"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" />{title}</div></CardHeader><CardContent><p className="text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p>{action ? <div className="mt-3 text-sm font-medium hover:underline">{action}</div> : null}</CardContent></Card>
}

function FileRows({ username, files, renderLink, showDate = false }: { username: string; files: StorageAnalyzerSnapshot["largest"]; renderLink: StorageLinkRenderer; showDate?: boolean }) {
  return <div className="space-y-1">{files.map((file) => <div key={file.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50"><FilesIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1">{renderLink({ href: workspaceFilePath(username, file.id), className: "block truncate text-sm font-medium hover:underline", children: file.name })}<p className="truncate text-xs text-muted-foreground">{file.category}{showDate ? " · content changed " + formatDate(file.contentUpdatedAt) : " · " + file.mimeType}</p></div><span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatBytes(file.sizeBytes)}</span></div>)}</div>
}

function Empty({ label }: { label: string }) { return <p className="py-6 text-center text-sm text-muted-foreground">{label}</p> }
function searchHref(username: string, query: Record<string, string>) { const params = new URLSearchParams(query); return workspacePath(username, "search") + "?" + params.toString() }

import type { StorageAnalyzerSnapshot } from "@discloud/api/models"
import { formatBytes, formatDate, formatNumber } from "@discloud/shared/format"
import { workspaceFilePath, workspacePath } from "@discloud/shared/navigation"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { CopyIcon, DatabaseIcon, FilesIcon, HardDriveIcon, HistoryIcon, Trash2Icon } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

export type StorageLinkRenderer = (props: { href: string; className?: string; children: ReactNode }) => ReactElement

export function StorageAnalyzerView({ username, data, renderLink }: { username: string; data: StorageAnalyzerSnapshot; renderLink: StorageLinkRenderer }) {
  const largestHref = searchHref(username, { kind: "file", sort: "size", order: "desc" })
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-sm text-muted-foreground">Usage and cleanup signals for @{username}.</p>
      </div>

      <Card className="overflow-hidden"><CardContent className="grid p-0 lg:grid-cols-[1.35fr_repeat(3,minmax(0,1fr))]">
        <OverviewMetric icon={HardDriveIcon} label="Logical storage" value={formatBytes(data.summary.logicalBytes)} meta={`${formatNumber(data.summary.fileCount)} active files`} primary />
        <OverviewMetric icon={DatabaseIcon} label="Referenced chunks" value={formatBytes(data.summary.referencedChunkBytes)} meta="Deduplicated references" />
        <OverviewMetric icon={Trash2Icon} label="Trash" value={formatBytes(data.summary.trashBytes)} meta={`${formatNumber(data.summary.trashFileCount)} files`} action={renderLink({ href: workspacePath(username, "trash"), children: "Review" })} />
        <OverviewMetric icon={HistoryIcon} label="Version history" value={formatBytes(data.summary.versionBytes)} meta="Retained revisions" />
      </CardContent></Card>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>Usage by category</CardTitle><Badge variant="secondary">{formatNumber(data.categories.length)} categories</Badge></CardHeader>
          <CardContent className="space-y-3">
            {data.categories.length === 0 ? <Empty label="No files to analyze." /> : data.categories.map((item) => {
              const percent = data.summary.logicalBytes > 0 ? item.bytes / data.summary.logicalBytes * 100 : 0
              return (
                <div key={item.category} className="space-y-1.5 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    {renderLink({ href: searchHref(username, { kind: "file", category: item.category, sort: "size", order: "desc" }), className: "min-w-0 truncate font-medium capitalize hover:underline", children: item.category })}
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(item.bytes)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: String(Math.max(0, Math.min(100, percent))) + "%" }} /></div>
                  <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground"><span>{formatNumber(item.fileCount)} files</span><span>{formatNumber(percent)}%</span></div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-2"><CardTitle>Largest files</CardTitle><Badge variant="secondary">{formatNumber(data.largest.length)}</Badge></div><Button size="sm" variant="outline" asChild>{renderLink({ href: largestHref, children: "View all" })}</Button></CardHeader>
          <CardContent>{data.largest.length === 0 ? <Empty label="No files to analyze." /> : <FileRows username={username} files={data.largest} renderLink={renderLink} />}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Old files</CardTitle><MetricBadges values={[`${data.oldFiles.thresholdDays}+ days`, `${formatNumber(data.oldFiles.totalFiles)} files`, formatBytes(data.oldFiles.totalBytes)]} /></CardHeader>
          <CardContent>{data.oldFiles.items.length === 0 ? <Empty label={"No files have been unchanged for " + data.oldFiles.thresholdDays + "+ days."} /> : <FileRows username={username} files={data.oldFiles.items} renderLink={renderLink} showDate />}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Duplicate files</CardTitle><MetricBadges values={[`${formatNumber(data.duplicates.groupCount)} groups`, `${formatBytes(data.duplicates.totalDuplicateLogicalBytes)} logical`]} /></CardHeader>
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

      <p className="text-xs text-muted-foreground">Referenced chunks include file versions and trash; deduplication means this is not a reclaimable-space estimate.</p>
    </div>
  )
}

function OverviewMetric({ icon: Icon, label, value, meta, action, primary = false }: { icon: typeof FilesIcon; label: string; value: string; meta: string; action?: ReactNode; primary?: boolean }) {
  return <div className="min-w-0 border-t p-4 first:border-t-0 lg:border-l lg:border-t-0 lg:first:border-l-0"><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="size-4" />{label}</div><div className="mt-2 flex min-w-0 items-end justify-between gap-3"><div className="min-w-0"><p className={`${primary ? "text-3xl" : "text-2xl"} truncate font-semibold tracking-tight tabular-nums`} title={value}>{value}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p></div>{action ? <div className="shrink-0 text-xs font-medium hover:underline">{action}</div> : null}</div></div>
}

function MetricBadges({ values }: { values: string[] }) { return <div className="mt-2 flex flex-wrap gap-1.5">{values.map((value) => <Badge key={value} variant="secondary" className="font-normal tabular-nums">{value}</Badge>)}</div> }

function FileRows({ username, files, renderLink, showDate = false }: { username: string; files: StorageAnalyzerSnapshot["largest"]; renderLink: StorageLinkRenderer; showDate?: boolean }) {
  return <div className="space-y-1">{files.map((file) => <div key={file.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50"><FilesIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1">{renderLink({ href: workspaceFilePath(username, file.id), className: "block truncate text-sm font-medium hover:underline", children: file.name })}<p className="truncate text-xs text-muted-foreground">{file.category}{showDate ? " · content changed " + formatDate(file.contentUpdatedAt) : " · " + file.mimeType}</p></div><span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatBytes(file.sizeBytes)}</span></div>)}</div>
}

function Empty({ label }: { label: string }) { return <p className="py-6 text-center text-sm text-muted-foreground">{label}</p> }
function searchHref(username: string, query: Record<string, string>) { const params = new URLSearchParams(query); return workspacePath(username, "search") + "?" + params.toString() }

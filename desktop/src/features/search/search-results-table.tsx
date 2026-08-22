import type { SearchResult } from "@discloud/api/models"
import { FileTypeIcon } from "@discloud/app-ui/files/file-node-visual"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { workspaceCollectionFilePath, workspaceFilePath, workspaceFolderPath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { DownloadIcon, FolderIcon, HeartIcon, Loader2Icon, Share2Icon, StarIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Link } from "react-router"

import { errorMessage } from "#lib/instance"

import { downloadNativeFile } from "../files/native"

export function DesktopSearchResultsTable({ username, results, renderActions }: { username: string; results: readonly SearchResult[]; renderActions?: (result: SearchResult) => ReactNode }) {
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(() => new Set())
  const [downloadError, setDownloadError] = useState<string>()

  async function download(result: SearchResult) {
    if (downloading.has(result.id)) return

    setDownloading((current) => new Set(current).add(result.id))
    setDownloadError(undefined)

    try {
      await downloadNativeFile({ id: result.id, name: result.name }, result.collectionId || undefined)
    } catch (error) {
      setDownloadError(errorMessage(error))
    } finally {
      setDownloading((current) => {
        const next = new Set(current)
        next.delete(result.id)
        return next
      })
    }
  }

  return (
    <div className="space-y-3">
      {downloadError ? <p role="alert" className="text-sm text-destructive">{downloadError}</p> : null}

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden sm:table-cell">Access</TableHead>
              <TableHead className="hidden w-28 lg:table-cell">Size</TableHead>
              <TableHead className="hidden w-36 xl:table-cell">Modified</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {results.map((result) => (
              <TableRow key={result.id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    {result.kind === "folder"
                      ? <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      : <FileTypeIcon category={result.category} className="size-4 shrink-0 text-muted-foreground" />}

                    <Link to={resultPath(username, result)} className="truncate font-medium hover:underline">{result.name}</Link>
                    {result.isFavorite ? <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" /> : null}
                  </div>
                </TableCell>

                <TableCell className="hidden capitalize text-muted-foreground md:table-cell">
                  {result.kind === "folder" ? "Folder" : result.category || "File"}
                </TableCell>

                <TableCell className="hidden sm:table-cell">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {result.shared ? (
                      <>
                        <Share2Icon className="size-3.5" />
                        Shared
                      </>
                    ) : result.isFavorite ? (
                      <>
                        <HeartIcon className="size-3.5" />
                        Favorite
                      </>
                    ) : "Workspace"}
                  </div>
                </TableCell>

                <TableCell className="hidden text-muted-foreground lg:table-cell">{result.size != null ? formatBytes(result.size) : "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{formatDate(result.updatedAt)}</TableCell>

                <TableCell>
                  <div className="flex justify-end gap-1">
                    {result.kind === "file" ? (
                      <Button size="icon-sm" variant="ghost" disabled={downloading.has(result.id)} aria-label={`Download ${result.name}`} title="Download" onClick={() => void download(result)}>
                        {downloading.has(result.id) ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                      </Button>
                    ) : null}
                    {renderActions?.(result)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function resultPath(username: string, result: SearchResult) {
  if (result.kind === "folder") return workspaceFolderPath(username, result.id)
  if (result.collectionId) return workspaceCollectionFilePath(username, result.collectionId, result.id)
  return workspaceFilePath(username, result.id)
}
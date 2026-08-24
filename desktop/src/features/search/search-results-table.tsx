import type { SearchResult } from "@discloud/api/models"
import { SearchResultsTable } from "@discloud/app-ui/search/search-results-table"
import { workspaceCollectionFilePath, workspaceFilePath, workspaceFolderPath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { DownloadIcon, Loader2Icon } from "lucide-react"
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
      setDownloading((current) => { const next = new Set(current); next.delete(result.id); return next })
    }
  }

  return <div className="space-y-3">{downloadError ? <p role="alert" className="text-sm text-destructive">{downloadError}</p> : null}<SearchResultsTable results={results} renderLink={(result, className, children) => <Link to={resultPath(username, result)} className={className}>{children}</Link>} renderActions={(result) => <>{result.kind === "file" ? <Button size="icon-sm" variant="ghost" disabled={downloading.has(result.id)} aria-label={`Download ${result.name}`} title="Download" onClick={() => void download(result)}>{downloading.has(result.id) ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}</Button> : null}{renderActions?.(result)}</>} /></div>
}

function resultPath(username: string, result: SearchResult) {
  if (result.kind === "folder") return workspaceFolderPath(username, result.id)
  if (result.collectionId) return workspaceCollectionFilePath(username, result.collectionId, result.id)
  return workspaceFilePath(username, result.id)
}

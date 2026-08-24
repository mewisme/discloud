"use client"

import type { SearchResult } from "@discloud/api/models"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FolderIcon, HeartIcon, Share2Icon, StarIcon } from "lucide-react"
import type { ReactNode } from "react"
import { FileTypeIcon } from "../../files/ui/file-node-visual"

export type SearchResultLinkRenderer = (result: SearchResult, className: string, children: ReactNode) => ReactNode

export function SearchResultsTable({ results, renderLink, renderModified, renderActions, showAccess = true }: { results: readonly SearchResult[]; renderLink: SearchResultLinkRenderer; renderModified?: (result: SearchResult) => ReactNode; renderActions?: (result: SearchResult) => ReactNode; showAccess?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            {showAccess ? <TableHead className="hidden sm:table-cell">Access</TableHead> : null}
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
                  {result.kind === "folder" ? <FolderIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileTypeIcon category={result.category} className="size-4 shrink-0 text-muted-foreground" />}
                  {renderLink(result, "truncate font-medium hover:underline", result.name)}
                  {result.isFavorite ? <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" /> : null}
                </div>
              </TableCell>
              <TableCell className="hidden capitalize text-muted-foreground md:table-cell">{result.kind === "folder" ? "Folder" : result.category || "File"}</TableCell>
              {showAccess ? (
                <TableCell className="hidden sm:table-cell">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {result.shared ? <><Share2Icon className="size-3.5" />Shared</> : result.isFavorite ? <><HeartIcon className="size-3.5" />Favorite</> : "Workspace"}
                  </div>
                </TableCell>
              ) : null}
              <TableCell className="hidden text-muted-foreground lg:table-cell">{result.size != null ? formatBytes(result.size) : "—"}</TableCell>
              <TableCell className="hidden text-muted-foreground xl:table-cell">{renderModified ? renderModified(result) : formatDate(result.updatedAt)}</TableCell>
              <TableCell><div className="flex justify-end gap-1">{renderActions?.(result)}</div></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

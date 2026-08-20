"use client"

import { DownloadIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, HeartIcon, Share2Icon, StarIcon } from "lucide-react"
import Link from "next/link"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateTime } from "@/components/common/date-time"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import type { SearchResult } from "@/lib/api/models"
import { fileBrowserPath, folderBrowserPath } from "@/lib/files/navigation"
import { formatBytes } from "@/lib/helpers"

export function SearchResultRow({ result }: { result: SearchResult }) {
  const workspace = useWorkspace()
  const href = result.kind === "folder"
    ? folderBrowserPath(workspace.username, result.id)
    : fileBrowserPath(workspace.username, result.id)

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <SearchResultIcon result={result} />
          <Link href={href} className="truncate font-medium hover:underline">
            {result.name}
          </Link>
          {result.isFavorite && (
            <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" />
          )}
        </div>
      </TableCell>

      <TableCell className="hidden capitalize text-muted-foreground md:table-cell">
        {result.kind === "folder" ? "Folder" : result.category || "File"}
      </TableCell>

      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {result.shared
            ? (
              <>
                <Share2Icon className="size-3.5" />
                Shared
              </>
            )
            : result.isFavorite
              ? (
                <>
                  <HeartIcon className="size-3.5" />
                  Favorite
                </>
              )
              : "Workspace"}
        </div>
      </TableCell>

      <TableCell className="hidden text-muted-foreground lg:table-cell">
        {result.size != null ? formatBytes(result.size) : "—"}
      </TableCell>

      <TableCell className="hidden text-muted-foreground xl:table-cell">
        <DateTime value={result.updatedAt} />
      </TableCell>

      <TableCell>
        {result.kind === "file" && (
          <Button size="icon-sm" variant="ghost" asChild>
            <a
              href={`/api/backend/api/v1/files/${encodeURIComponent(result.id)}/download`}
              aria-label={`Download ${result.name}`}
            >
              <DownloadIcon />
            </a>
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

function SearchResultIcon({ result }: { result: SearchResult }) {
  if (result.kind === "folder") return <FolderIcon className="size-4 shrink-0" />

  switch (result.category) {
    case "image":
      return <FileImageIcon className="size-4 shrink-0" />
    case "video":
      return <FileVideoIcon className="size-4 shrink-0" />
    case "audio":
      return <FileAudioIcon className="size-4 shrink-0" />
    case "document":
    case "text":
      return <FileTextIcon className="size-4 shrink-0" />
    case "archive":
      return <FileArchiveIcon className="size-4 shrink-0" />
    default:
      return <FileIcon className="size-4 shrink-0" />
  }
}
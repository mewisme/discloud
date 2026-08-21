"use client"

import { DownloadIcon, FolderIcon, FolderUpIcon, Loader2Icon } from "lucide-react"

import { FileTypeIcon } from "@/components/files/file-type-icon"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiURL } from "@/lib/api/client"
import type { PublicNode } from "@/lib/api/models"
import { formatBytes, formatDate, isInteractiveTarget } from "@/lib/helpers"
import { publicFileDownloadPath, publicFolderDownloadPath } from "@/lib/shares/public"

export function PublicEntriesTable({
  publicId,
  entries,
  loading = false,
  parent,
  onOpenFolder,
  onOpenFile,
}: {
  publicId: string
  entries: readonly PublicNode[]
  loading?: boolean
  parent?: () => void
  onOpenFolder?: (node: PublicNode) => void
  onOpenFile: (node: PublicNode) => void
}) {
  if (!entries.length && !parent) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-dashed bg-background p-6 text-center">
        <div>
          <FolderIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="font-medium">Nothing here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This shared resource is empty.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden w-28 sm:table-cell">Size</TableHead>
            <TableHead className="hidden w-36 lg:table-cell">Modified</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {parent && (
            <TableRow
              className="cursor-pointer select-none"
              onClick={parent}
            >
              <TableCell>
                <div className="flex items-center gap-2 font-medium">
                  <FolderUpIcon className="size-4 text-muted-foreground" />
                  ..
                </div>
              </TableCell>

              <TableCell className="hidden text-muted-foreground md:table-cell">
                Parent folder
              </TableCell>

              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden lg:table-cell" />
              <TableCell />
            </TableRow>
          )}

          {entries.map((node) => (
            <TableRow
              key={node.id}
              className="select-none"
              onDoubleClick={(event) => {
                if (isInteractiveTarget(event.target)) return

                if (node.kind === "folder") {
                  onOpenFolder?.(node)
                } else {
                  onOpenFile(node)
                }
              }}
            >
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <PublicNodeIcon node={node} />

                  <button
                    type="button"
                    className="truncate text-left font-medium hover:underline"
                    onClick={() => {
                      if (node.kind === "folder") {
                        onOpenFolder?.(node)
                      } else {
                        onOpenFile(node)
                      }
                    }}
                  >
                    {node.name}
                  </button>
                </div>
              </TableCell>

              <TableCell className="hidden capitalize text-muted-foreground md:table-cell">
                {node.kind === "folder"
                  ? "Folder"
                  : node.category || node.mimeType || "File"}
              </TableCell>

              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {node.kind === "file" && node.size != null
                  ? formatBytes(node.size)
                  : "—"}
              </TableCell>

              <TableCell className="hidden text-muted-foreground lg:table-cell">
                {formatDate(node.updatedAt)}
              </TableCell>

              <TableCell>
                <Button size="icon-sm" variant="ghost" asChild>
                  <a
                    href={apiURL(
                      node.kind === "folder"
                        ? publicFolderDownloadPath(publicId, node.id)
                        : publicFileDownloadPath(publicId, node.id),
                    )}
                    aria-label={`Download ${node.name}`}
                  >
                    <DownloadIcon />
                  </a>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {loading && (
        <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <Loader2Icon className="size-3.5 animate-spin" />
            Loading folder…
          </div>
        </div>
      )}
    </div>
  )
}

function PublicNodeIcon({ node }: { node: PublicNode }) {
  if (node.kind === "folder") {
    return <FolderIcon className="size-4 shrink-0" />
  }

  return (
    <FileTypeIcon
      category={node.category}
      className="size-4 shrink-0"
    />
  )
}
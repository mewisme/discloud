"use client"

import { CloudIcon, DownloadIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, FolderUpIcon, Globe2Icon, LibraryIcon, Loader2Icon } from "lucide-react"
import Link from "next/link"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"

import { FilePreview } from "@/components/files/file-preview"
import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON, apiURL } from "@/lib/api/client"
import type { PublicFolder, PublicNode, PublicShare } from "@/lib/api/models"
import { apiErrorMessage, formatBytes, formatDate, isInteractiveTarget } from "@/lib/helpers"
import { publicFileContentPath, publicFileDownloadPath, publicFolderDownloadPath, publicFolderPath } from "@/lib/shares/public"

type PublicFile = NonNullable<PublicShare["file"]>
type PublicCollection = NonNullable<PublicShare["collection"]>

export function PublicShareView({ share }: { share: PublicShare }) {
  return (
    <PublicShell>
      {share.resourceType === "file" && share.file ? (
        <PublicFileView publicId={share.publicId} file={share.file} />
      ) : share.resourceType === "folder" && share.folder ? (
        <PublicFolderView publicId={share.publicId} root={share.folder} />
      ) : share.resourceType === "collection" && share.collection ? (
        <PublicCollectionView publicId={share.publicId} collection={share.collection} />
      ) : (
        <UnavailableShare />
      )}
    </PublicShell>
  )
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <CloudIcon className="size-4" />
            </span>
            <span>DisCloud</span>
          </Link>
          <Badge variant="secondary" className="ml-auto">
            <Globe2Icon />
            Public share
          </Badge>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/">Open DisCloud</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  )
}

function PublicFileView({ publicId, file }: { publicId: string; file: PublicFile }) {
  const source = {
    contentPath: publicFileContentPath(publicId),
    downloadPath: publicFileDownloadPath(publicId),
  }

  return (
    <div className="space-y-5">
      <ResourceHeading
        icon={<FileIcon className="size-5" />}
        title={file.name}
        description="Shared file"
        action={
          <Button asChild>
            <a href={apiURL(source.downloadPath)}>
              <DownloadIcon />
              Download
            </a>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <Info label="Size" value={formatBytes(file.size)} />
        <Info label="Type" value={file.mimeType} />
        <Info label="Modified" value={formatDate(file.updatedAt)} />
        <Info label="SHA-256" value={file.sha256 ? `${file.sha256.slice(0, 12)}…` : "—"} mono />
      </div>

      <FilePreview file={{ id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, category: file.category }} source={source} />
    </div>
  )
}

function PublicFolderView({ publicId, root }: { publicId: string; root: PublicFolder }) {
  const [path, setPath] = useState<PublicFolder[]>([root])
  const [preview, setPreview] = useState<PublicNode>()
  const [loading, setLoading] = useState(false)
  const current = path[path.length - 1]
  const breadcrumbs = path.map((folder, index) => ({ id: folder.id, label: folder.name || (index === 0 ? "Shared folder" : "Folder") }))

  async function openFolder(node: PublicNode) {
    if (loading) return
    setLoading(true)

    try {
      const folder = await apiJSON<PublicFolder>(publicFolderPath(publicId, node.id))
      setPath((currentPath) => [...currentPath, folder])
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not open this folder"))
    } finally {
      setLoading(false)
    }
  }

  function navigateBreadcrumb(folderId: string) {
    const index = path.findIndex((folder) => folder.id === folderId)
    if (index >= 0) setPath((currentPath) => currentPath.slice(0, index + 1))
  }

  return (
    <div className="space-y-5">
      <CompactBreadcrumbs items={breadcrumbs} onNavigate={(item) => navigateBreadcrumb(item.id)} />

      <ResourceHeading
        icon={<FolderIcon className="size-5" />}
        title={current.name || "Shared folder"}
        description={`${current.children.length} item${current.children.length === 1 ? "" : "s"}`}
        action={
          <Button variant="outline" asChild>
            <a href={apiURL(publicFolderDownloadPath(publicId, current.id))}>
              <DownloadIcon />
              Download folder
            </a>
          </Button>
        }
      />

      <PublicEntriesTable
        publicId={publicId}
        entries={current.children}
        loading={loading}
        parent={path.length > 1 ? () => setPath((currentPath) => currentPath.slice(0, -1)) : undefined}
        onOpenFolder={openFolder}
        onOpenFile={setPreview}
      />

      <PublicPreviewDialog publicId={publicId} file={preview} onOpenChange={(open) => !open && setPreview(undefined)} />
    </div>
  )
}

function PublicCollectionView({ publicId, collection }: { publicId: string; collection: PublicCollection }) {
  const [preview, setPreview] = useState<PublicNode>()

  return (
    <div className="space-y-5">
      <ResourceHeading
        icon={<LibraryIcon className="size-5" />}
        title={collection.name}
        description={collection.description || `${collection.items.length} shared file${collection.items.length === 1 ? "" : "s"}`}
      />

      <PublicEntriesTable publicId={publicId} entries={collection.items} onOpenFile={setPreview} />

      <PublicPreviewDialog publicId={publicId} file={preview} onOpenChange={(open) => !open && setPreview(undefined)} />
    </div>
  )
}

function ResourceHeading({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border bg-background shadow-sm">{icon}</div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="truncate text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function PublicEntriesTable({
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
          <p className="mt-1 text-sm text-muted-foreground">This shared resource is empty.</p>
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
            <TableRow className="cursor-pointer select-none" onClick={parent}>
              <TableCell>
                <div className="flex items-center gap-2 font-medium">
                  <FolderUpIcon className="size-4 text-muted-foreground" />
                  ..
                </div>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">Parent folder</TableCell>
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
                if (node.kind === "folder") onOpenFolder?.(node)
                else onOpenFile(node)
              }}
            >
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <PublicNodeIcon node={node} />
                  <button type="button" className="truncate text-left font-medium hover:underline" onClick={() => node.kind === "folder" ? onOpenFolder?.(node) : onOpenFile(node)}>
                    {node.name}
                  </button>
                </div>
              </TableCell>
              <TableCell className="hidden capitalize text-muted-foreground md:table-cell">{node.kind === "folder" ? "Folder" : node.category || node.mimeType || "File"}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{node.kind === "file" && node.size != null ? formatBytes(node.size) : "—"}</TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(node.updatedAt)}</TableCell>
              <TableCell>
                <Button size="icon-sm" variant="ghost" asChild>
                  <a href={apiURL(node.kind === "folder" ? publicFolderDownloadPath(publicId, node.id) : publicFileDownloadPath(publicId, node.id))} aria-label={`Download ${node.name}`}>
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

function PublicPreviewDialog({ publicId, file, onOpenChange }: { publicId: string; file?: PublicNode; onOpenChange: (open: boolean) => void }) {
  if (!file) return null

  const source = {
    contentPath: publicFileContentPath(publicId, file.id),
    downloadPath: publicFileDownloadPath(publicId, file.id),
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{file.name}</DialogTitle>
          <DialogDescription>{file.size != null ? formatBytes(file.size) : "File"} · {file.mimeType || "Unknown type"}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" asChild>
            <a href={apiURL(source.downloadPath)}>
              <DownloadIcon />
              Download
            </a>
          </Button>
        </div>

        <FilePreview file={{ id: file.id, name: file.name, size: file.size ?? 0, mimeType: file.mimeType || "application/octet-stream", category: file.category }} source={source} />
      </DialogContent>
    </Dialog>
  )
}

function PublicNodeIcon({ node }: { node: PublicNode }) {
  if (node.kind === "folder") return <FolderIcon className="size-4 shrink-0" />

  switch (node.category) {
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

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-medium ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</p>
    </div>
  )
}

function UnavailableShare() {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-center">
      <div>
        <Globe2Icon className="mx-auto mb-3 size-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Share unavailable</h1>
        <p className="mt-1 text-sm text-muted-foreground">This public resource could not be displayed.</p>
      </div>
    </div>
  )
}
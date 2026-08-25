"use client"

import type { TrashItem } from "@discloud/api/models"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FileIcon, FolderIcon, Loader2Icon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { type ReactNode, useState } from "react"

export function TrashView({ username, items, pending, actionError, pagination, renderDeletedAt, onRestore, onDeleteForever }: { username: string; items: readonly TrashItem[]; pending: ReadonlySet<string>; actionError?: string; pagination?: ReactNode; renderDeletedAt?: (item: TrashItem) => ReactNode; onRestore: (item: TrashItem) => void | Promise<void>; onDeleteForever: (item: TrashItem) => boolean | Promise<boolean> }) {
  const [deleteTarget, setDeleteTarget] = useState<TrashItem>()
  const deleting = deleteTarget ? pending.has(deleteTarget.node.id) : false

  async function deleteForever() {
    if (!deleteTarget || deleting) return
    if (await onDeleteForever(deleteTarget)) setDeleteTarget(undefined)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Trash</h1><p className="text-sm text-muted-foreground">Deleted files and folders owned by @{username}.</p></div>
      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
      {items.length === 0 && !pagination ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><Trash2Icon className="mx-auto size-10 text-muted-foreground" /><div><p className="font-medium">Trash is empty</p><p className="text-sm text-muted-foreground">Files and folders moved to trash will appear here.</p></div></div></div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="table-fixed"><TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden w-24 sm:table-cell">Type</TableHead><TableHead className="hidden w-28 md:table-cell">Size</TableHead><TableHead className="hidden w-44 lg:table-cell">Deleted</TableHead><TableHead className="w-56" /></TableRow></TableHeader>
          <TableBody>{items.map((item) => { const itemPending = pending.has(item.node.id); return <TableRow key={`${item.node.kind}:${item.node.id}`}>
            <TableCell className="min-w-0 overflow-hidden"><div className="flex min-w-0 items-center gap-2">{item.node.kind === "folder" ? <FolderIcon className="size-4 shrink-0" /> : <FileIcon className="size-4 shrink-0" />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{item.node.name}</p><p className="truncate text-xs capitalize text-muted-foreground sm:hidden">{item.node.kind}</p></div></div></TableCell>
            <TableCell className="hidden capitalize text-muted-foreground sm:table-cell">{item.node.kind}</TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">{item.sizeBytes == null ? "—" : formatBytes(item.sizeBytes)}</TableCell>
            <TableCell className="hidden text-muted-foreground lg:table-cell" title={item.deletedAt}>{renderDeletedAt ? renderDeletedAt(item) : formatDate(item.deletedAt)}</TableCell>
            <TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={itemPending} onClick={() => void onRestore(item)}>{itemPending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}Restore</Button><Button size="icon-sm" variant="destructive" disabled={itemPending} aria-label={`Delete ${item.node.name} forever`} title="Delete forever" onClick={() => setDeleteTarget(item)}><Trash2Icon /></Button></div></TableCell>
          </TableRow> })}</TableBody></Table>
          {pagination ? <div className="border-t">{pagination}</div> : null}
        </div>
      )}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(undefined) }}>
        <AlertDialogContent><AlertDialogHeader><TriangleAlertIcon /><AlertDialogTitle>Delete {deleteTarget?.node.name} forever?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.node.kind === "folder" ? "This permanently removes the folder, all of its children, and their DisCloud database records. This cannot be undone." : "This permanently removes the file and its DisCloud database records. This cannot be undone."}</AlertDialogDescription></AlertDialogHeader><div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">Discord messages and attachments are intentionally left untouched. Unreferenced chunk records are removed only from the DisCloud database.</div><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><Button variant="destructive" disabled={!deleteTarget || deleting} onClick={() => void deleteForever()}>{deleting ? <Loader2Icon className="animate-spin" /> : null}Delete forever</Button></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

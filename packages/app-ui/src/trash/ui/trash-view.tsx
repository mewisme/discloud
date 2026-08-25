"use client"

import type { TrashItem } from "@discloud/api/models"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FileIcon, FolderIcon, Loader2Icon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

const destructiveConfirmDelaySeconds = 3

function useConfirmDelay() {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRemaining((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [remaining])
  return { remaining, start: () => setRemaining(destructiveConfirmDelaySeconds), reset: () => setRemaining(0) }
}

export function TrashView({ username, items, pending, emptying = false, emptyDisabled = false, actionError, pagination, renderDeletedAt, onRestore, onDeleteForever, onEmptyTrash }: { username: string; items: readonly TrashItem[]; pending: ReadonlySet<string>; emptying?: boolean; emptyDisabled?: boolean; actionError?: string; pagination?: ReactNode; renderDeletedAt?: (item: TrashItem) => ReactNode; onRestore: (item: TrashItem) => void | Promise<void>; onDeleteForever: (item: TrashItem) => boolean | Promise<boolean>; onEmptyTrash: () => boolean | Promise<boolean> }) {
  const [deleteTarget, setDeleteTarget] = useState<TrashItem>()
  const [emptyOpen, setEmptyOpen] = useState(false)
  const deleting = deleteTarget ? pending.has(deleteTarget.node.id) : false
  const deleteDelay = useConfirmDelay()
  const emptyDelay = useConfirmDelay()
  const hasTrash = items.length > 0 || !!pagination

  async function deleteForever() {
    if (!deleteTarget || deleting) return
    if (await onDeleteForever(deleteTarget)) setDeleteTarget(undefined)
  }

  async function emptyTrash() {
    if (emptying) return
    if (await onEmptyTrash()) setEmptyOpen(false)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h1 className="text-2xl font-semibold tracking-tight">Trash</h1><p className="text-sm text-muted-foreground">Deleted files and folders owned by @{username}.</p></div>{hasTrash ? <Button variant="destructive" disabled={emptying || emptyDisabled || pending.size > 0} onClick={() => { emptyDelay.start(); setEmptyOpen(true) }}>{emptying ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}Empty trash</Button> : null}</div>
      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
      {items.length === 0 && !pagination ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><Trash2Icon className="mx-auto size-10 text-muted-foreground" /><div><p className="font-medium">Trash is empty</p><p className="text-sm text-muted-foreground">Files and folders moved to trash will appear here.</p></div></div></div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="table-fixed"><TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden w-24 sm:table-cell">Type</TableHead><TableHead className="hidden w-28 md:table-cell">Size</TableHead><TableHead className="hidden w-44 lg:table-cell">Deleted</TableHead><TableHead className="w-56" /></TableRow></TableHeader>
          <TableBody>{items.map((item) => { const itemPending = emptying || pending.has(item.node.id); return <TableRow key={`${item.node.kind}:${item.node.id}`}>
            <TableCell className="min-w-0 overflow-hidden"><div className="flex min-w-0 items-center gap-2">{item.node.kind === "folder" ? <FolderIcon className="size-4 shrink-0" /> : <FileIcon className="size-4 shrink-0" />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{item.node.name}</p><p className="truncate text-xs capitalize text-muted-foreground sm:hidden">{item.node.kind}</p></div></div></TableCell>
            <TableCell className="hidden capitalize text-muted-foreground sm:table-cell">{item.node.kind}</TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">{item.sizeBytes == null ? "—" : formatBytes(item.sizeBytes)}</TableCell>
            <TableCell className="hidden text-muted-foreground lg:table-cell" title={item.deletedAt}>{renderDeletedAt ? renderDeletedAt(item) : formatDate(item.deletedAt)}</TableCell>
            <TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={itemPending} onClick={() => void onRestore(item)}>{itemPending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}Restore</Button><Button size="icon-sm" variant="destructive" disabled={itemPending} aria-label={`Delete ${item.node.name} forever`} title="Delete forever" onClick={() => { deleteDelay.start(); setDeleteTarget(item) }}><Trash2Icon /></Button></div></TableCell>
          </TableRow> })}</TableBody></Table>
          {pagination ? <div className="border-t">{pagination}</div> : null}
        </div>
      )}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) { deleteDelay.reset(); setDeleteTarget(undefined) } }}>
        <AlertDialogContent><AlertDialogHeader><TriangleAlertIcon /><AlertDialogTitle>Delete {deleteTarget?.node.name} forever?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.node.kind === "folder" ? "This permanently removes the folder, all of its children, and their DisCloud database records. This cannot be undone." : "This permanently removes the file and its DisCloud database records. This cannot be undone."}</AlertDialogDescription></AlertDialogHeader><div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">Discord messages and attachments are intentionally left untouched. Unreferenced chunk records are removed only from the DisCloud database.</div><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><Button variant="destructive" disabled={!deleteTarget || deleting || deleteDelay.remaining > 0} onClick={() => void deleteForever()}>{deleting ? <Loader2Icon className="animate-spin" /> : null}{deleteDelay.remaining > 0 ? `Delete forever (${deleteDelay.remaining})` : "Delete forever"}</Button></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={emptyOpen} onOpenChange={(open) => { if (!emptying) { if (!open) emptyDelay.reset(); setEmptyOpen(open) } }}>
        <AlertDialogContent><AlertDialogHeader><TriangleAlertIcon /><AlertDialogTitle>Empty trash?</AlertDialogTitle><AlertDialogDescription>This permanently removes every file and folder currently in @{username}&apos;s trash, including items that are not loaded on this page. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">Discord messages and attachments are intentionally left untouched. Unreferenced chunk records are removed only from the DisCloud database.</div><AlertDialogFooter><AlertDialogCancel disabled={emptying}>Cancel</AlertDialogCancel><Button variant="destructive" disabled={emptying || emptyDelay.remaining > 0} onClick={() => void emptyTrash()}>{emptying ? <Loader2Icon className="animate-spin" /> : null}{emptyDelay.remaining > 0 ? `Empty trash (${emptyDelay.remaining})` : "Empty trash"}</Button></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

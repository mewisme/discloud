"use client"

import type { SharedItem } from "@discloud/api/models"
import { formatDate } from "@discloud/shared/format"
import { Badge } from "@discloud/ui/components/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FolderIcon, LibraryIcon, Share2Icon } from "lucide-react"
import type { ReactNode } from "react"

export type SharedItemLinkRenderer = (item: SharedItem, className: string, children: ReactNode) => ReactNode

export function SharedView({ items, renderLink, renderSharedAt }: { items: readonly SharedItem[]; renderLink: SharedItemLinkRenderer; renderSharedAt?: (item: SharedItem) => ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Shared</h1><p className="text-sm text-muted-foreground">Folders and collections shared directly with your account.</p></div>
      {items.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><Share2Icon className="mx-auto size-10 text-muted-foreground" /><div><p className="font-medium">Nothing shared with you</p><p className="text-sm text-muted-foreground">Shared folders and collections will appear here.</p></div></div></div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden md:table-cell">Owner</TableHead><TableHead className="w-24">Access</TableHead><TableHead className="hidden w-36 sm:table-cell">Shared</TableHead></TableRow></TableHeader>
          <TableBody>{items.map((item) => <TableRow key={`${item.kind}:${item.id}`}>
            <TableCell><div className="flex min-w-0 items-center gap-2">{item.kind === "folder" ? <FolderIcon className="size-4 shrink-0" /> : <LibraryIcon className="size-4 shrink-0" />}<div className="min-w-0">{renderLink(item, "block truncate font-medium hover:underline", itemName(item))}{item.description ? <p className="truncate text-xs text-muted-foreground">{item.description}</p> : null}</div></div></TableCell>
            <TableCell className="hidden md:table-cell"><p className="truncate">{item.ownerName}</p><p className="truncate text-xs text-muted-foreground">@{item.ownerUsername}</p></TableCell>
            <TableCell><Badge variant="secondary" className="capitalize">{item.accessLevel}</Badge></TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{renderSharedAt ? renderSharedAt(item) : formatDate(item.sharedAt)}</TableCell>
          </TableRow>)}</TableBody></Table>
        </div>
      )}
    </div>
  )
}

function itemName(item: SharedItem) {
  return item.kind === "folder" && (item.isRoot || !item.name) ? `${item.ownerName}'s workspace` : item.name
}

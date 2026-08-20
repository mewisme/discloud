import { FolderIcon, LibraryIcon, Share2Icon } from "lucide-react"
import Link from "next/link"

import { DateOnly } from "@/components/common/date-time"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SharedItem } from "@/lib/api/models"

export function SharedView({ items }: { items: readonly SharedItem[] }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared</h1>
        <p className="text-sm text-muted-foreground">Folders and collections shared directly with you.</p>
      </div>

      {items.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div className="space-y-3">
            <Share2Icon className="mx-auto size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Nothing shared with you</p>
              <p className="text-sm text-muted-foreground">Shared folders and collections will appear here.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="w-24">Access</TableHead>
                <TableHead className="hidden w-36 sm:table-cell">Shared</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={`${item.kind}:${item.id}`}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      {item.kind === "folder" ? <FolderIcon className="size-4 shrink-0" /> : <LibraryIcon className="size-4 shrink-0" />}
                      <div className="min-w-0">
                        <Link href={itemHref(item)} className="block truncate font-medium hover:underline">{itemName(item)}</Link>
                        {item.description && <p className="truncate text-xs text-muted-foreground">{item.description}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{item.ownerUsername}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{item.accessLevel}</Badge></TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell"><DateOnly value={item.sharedAt} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function itemName(item: SharedItem) {
  return item.kind === "folder" && (item.isRoot || !item.name) ? `${item.ownerUsername}'s Workspace` : item.name
}

function itemHref(item: SharedItem) {
  return item.kind === "folder" ? `/files/${encodeURIComponent(item.id)}` : `/collections/${encodeURIComponent(item.id)}`
}
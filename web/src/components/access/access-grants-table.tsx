"use client"

import { Loader2Icon, Trash2Icon } from "lucide-react"

import type { AccessGrantRow } from "@/components/access/use-access-grants"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AccessLevel } from "@/lib/api/models"

export function AccessGrantsTable({
  grants,
  mutating,
  pendingUserId,
  onUpdate,
  onRemove,
}: {
  grants: readonly AccessGrantRow[]
  mutating: boolean
  pendingUserId?: string
  onUpdate: (userId: string, level: AccessLevel) => void
  onRemove: (grant: AccessGrantRow) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="w-32">Access</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {grants.map((grant) => (
            <TableRow key={grant.userId}>
              <TableCell>
                <div className="min-w-0">
                  <p className="truncate font-medium">{grant.name}</p>
                  <p className="truncate text-xs text-muted-foreground">@{grant.username}</p>
                </div>
              </TableCell>

              <TableCell>
                <Select
                  value={grant.level}
                  disabled={mutating}
                  onValueChange={(value) => onUpdate(grant.userId, value as AccessLevel)}
                >
                  <SelectTrigger size="sm" aria-label={`Access level for ${grant.name} (@${grant.username})`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">View</SelectItem>
                    <SelectItem value="edit">Edit</SelectItem>
                    <SelectItem value="full">Full</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>

              <TableCell>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={mutating}
                  aria-label={`Remove access for ${grant.name} (@${grant.username})`}
                  onClick={() => onRemove(grant)}
                >
                  {pendingUserId === grant.userId ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
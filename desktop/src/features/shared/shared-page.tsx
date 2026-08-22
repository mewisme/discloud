import type { SharedItem, SharedItems } from "@discloud/api/models"
import { formatDate } from "@discloud/shared/format"
import { workspaceCollectionPath, workspaceFolderPath } from "@discloud/shared/navigation"
import { Badge } from "@discloud/ui/components/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FolderIcon, LibraryIcon, Loader2Icon, Share2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: readonly SharedItem[] }

export function DesktopSharedPage() {
  const { username } = useParams()
  const [state, setState] = useState<State>({ status: "loading" })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await apiJSON<SharedItems>("/api/v1/shared")
        if (!cancelled) setState({ status: "ready", items: data.items })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
  if (state.status === "error" || !username) return <p role="alert" className="text-sm text-destructive">{state.status === "error" ? state.message : "Workspace username is missing."}</p>

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared</h1>
        <p className="text-sm text-muted-foreground">Folders and collections shared directly with your account.</p>
      </div>

      {state.items.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <Share2Icon className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">Nothing shared with you</p>
            <p className="mt-1 text-sm text-muted-foreground">Shared folders and collections will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
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
              {state.items.map((item) => (
                <TableRow key={`${item.kind}:${item.id}`}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      {item.kind === "folder" ? <FolderIcon className="size-4 shrink-0" /> : <LibraryIcon className="size-4 shrink-0" />}
                      <div className="min-w-0">
                        <Link to={itemPath(username, item)} className="block truncate font-medium hover:underline">{itemName(item)}</Link>
                        {item.description ? <p className="truncate text-xs text-muted-foreground">{item.description}</p> : null}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <p className="truncate">{item.ownerName}</p>
                    <p className="truncate text-xs text-muted-foreground">@{item.ownerUsername}</p>
                  </TableCell>

                  <TableCell><Badge variant="secondary" className="capitalize">{item.accessLevel}</Badge></TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(item.sharedAt)}</TableCell>
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
  return item.kind === "folder" && (item.isRoot || !item.name) ? `${item.ownerName}'s workspace` : item.name
}

function itemPath(username: string, item: SharedItem) {
  return item.kind === "folder" ? workspaceFolderPath(username, item.id) : workspaceCollectionPath(username, item.id)
}
import type { SharedItem, SharedItems } from "@discloud/api/models"
import { SharedView } from "@discloud/app-ui/shared/shared-view"
import { workspaceCollectionPath, workspaceFolderPath } from "@discloud/shared/navigation"
import { Loader2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: readonly SharedItem[] }
export function DesktopSharedPage() {
  const { username } = useParams(); const [state, setState] = useState<State>({ status: "loading" })
  useEffect(() => { let cancelled = false; async function load() { try { const data = await apiJSON<SharedItems>("/api/v1/shared"); if (!cancelled) setState({ status: "ready", items: data.items }) } catch (error) { if (!cancelled) setState({ status: "error", message: errorMessage(error) }) } } void load(); return () => { cancelled = true } }, [])
  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
  if (state.status === "error" || !username) return <p role="alert" className="text-sm text-destructive">{state.status === "error" ? state.message : "Workspace username is missing."}</p>
  return <SharedView items={state.items} renderLink={(item, className, children) => <Link to={itemPath(username, item)} className={className}>{children}</Link>} />
}
function itemPath(username: string, item: SharedItem) { return item.kind === "folder" ? workspaceFolderPath(username, item.id) : workspaceCollectionPath(username, item.id) }

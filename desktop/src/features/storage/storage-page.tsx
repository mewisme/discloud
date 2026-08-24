import type { StorageAnalyzerSnapshot, WorkspaceDetails } from "@discloud/api/models"
import { StorageAnalyzerView } from "@discloud/app-ui/storage/storage-analyzer"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"

type WorkspaceState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails }
type AnalyzerState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: StorageAnalyzerSnapshot }

export function DesktopStoragePage() {
  const { username } = useParams()
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ status: "loading" })
  const [analyzerState, setAnalyzerState] = useState<AnalyzerState>({ status: "loading" })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!username) { setWorkspaceState({ status: "error", message: "Workspace username is missing." }); return }
      setWorkspaceState({ status: "loading" })
      try { const workspace = await loadDesktopWorkspace(username); if (!cancelled) setWorkspaceState({ status: "ready", workspace }) }
      catch (error) { if (!cancelled) setWorkspaceState({ status: "error", message: errorMessage(error) }) }
    }
    void load()
    return () => { cancelled = true }
  }, [username])

  useEffect(() => {
    if (workspaceState.status !== "ready") return
    const ownerId = workspaceState.workspace.owner.id
    let cancelled = false
    async function load() {
      setAnalyzerState({ status: "loading" })
      try { const data = await apiJSON<StorageAnalyzerSnapshot>("/api/v1/storage/analyzer", { query: { ownerId } }); if (!cancelled) setAnalyzerState({ status: "ready", data }) }
      catch (error) { if (!cancelled) setAnalyzerState({ status: "error", message: errorMessage(error) }) }
    }
    void load()
    return () => { cancelled = true }
  }, [retry, workspaceState])

  if (workspaceState.status === "loading") return <Loading />
  if (workspaceState.status === "error") return <ErrorState message={workspaceState.message} />
  if (analyzerState.status === "loading") return <Loading />
  if (analyzerState.status === "error") return <ErrorState message={analyzerState.message} onRetry={() => setRetry((value) => value + 1)} />
  return <StorageAnalyzerView username={workspaceState.workspace.owner.username} data={analyzerState.data} renderLink={({ href, className, children }) => <Link to={href} className={className}>{children}</Link>} />
}

function Loading() { return <div className="grid min-h-64 place-items-center rounded-xl border"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Analyzing storage…</div></div> }
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><div><p className="font-medium">Storage analyzer unavailable</p><p className="mt-1 text-sm text-muted-foreground">{message}</p></div>{onRetry ? <Button size="sm" variant="outline" onClick={onRetry}><RefreshCwIcon />Try again</Button> : null}</div></div> }

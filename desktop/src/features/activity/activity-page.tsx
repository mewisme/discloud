import type { RecentActivityPage, WorkspaceDetails } from "@discloud/api/models"
import { RecentActivityView } from "@discloud/app-ui/activity/recent-activity"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"

type WorkspaceState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails }
type ActivityState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: RecentActivityPage["items"]; nextCursor?: RecentActivityPage["nextCursor"] }

export function DesktopActivityPage() {
  const { username } = useParams()
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ status: "loading" })
  const [activityState, setActivityState] = useState<ActivityState>({ status: "loading" })
  const [retry, setRetry] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!username) { setWorkspaceState({ status: "error", message: "Workspace username is missing." }); return }
    setWorkspaceState({ status: "loading" })
    loadDesktopWorkspace(username).then((workspace) => { if (!cancelled) setWorkspaceState({ status: "ready", workspace }) }).catch((cause) => { if (!cancelled) setWorkspaceState({ status: "error", message: errorMessage(cause) }) })
    return () => { cancelled = true }
  }, [retry, username])

  useEffect(() => {
    if (workspaceState.status !== "ready") return
    const ownerId = workspaceState.workspace.owner.id
    let cancelled = false
    setActivityState({ status: "loading" })
    apiJSON<RecentActivityPage>("/api/v1/activity", { query: { ownerId, limit: 30 } }).then((page) => { if (!cancelled) setActivityState({ status: "ready", items: page.items, nextCursor: page.nextCursor }) }).catch((cause) => { if (!cancelled) setActivityState({ status: "error", message: errorMessage(cause) }) })
    return () => { cancelled = true }
  }, [workspaceState])

  async function loadMore() {
    if (workspaceState.status !== "ready" || activityState.status !== "ready" || !activityState.nextCursor || loadingMore) return
    const ownerId = workspaceState.workspace.owner.id
    const items = activityState.items
    const cursor = activityState.nextCursor
    setLoadingMore(true)
    try {
      const page = await apiJSON<RecentActivityPage>("/api/v1/activity", { query: { ownerId, limit: 30, beforeAt: cursor.beforeAt, beforeId: cursor.beforeId } })
      setActivityState({ status: "ready", items: [...items, ...page.items], nextCursor: page.nextCursor })
    } catch (cause) { setActivityState({ status: "error", message: errorMessage(cause) }) }
    finally { setLoadingMore(false) }
  }

  if (workspaceState.status === "loading") return <Loading />
  if (workspaceState.status === "error") return <ErrorState message={workspaceState.message} onRetry={() => setRetry((value) => value + 1)} />
  if (activityState.status === "loading") return <Loading />
  if (activityState.status === "error") return <ErrorState message={activityState.message} onRetry={() => setRetry((value) => value + 1)} />
  return <RecentActivityView username={workspaceState.workspace.owner.username} items={activityState.items} hasMore={Boolean(activityState.nextCursor)} loadingMore={loadingMore} onLoadMore={() => void loadMore()} renderLink={({ href, className, children }) => <Link to={href} className={className}>{children}</Link>} />
}

function Loading() { return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Loading activity…</div></div> }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><div><p className="font-medium">Recent activity unavailable</p><p className="mt-1 text-sm text-muted-foreground">{message}</p></div><Button size="sm" variant="outline" onClick={onRetry}><RefreshCwIcon />Try again</Button></div></div> }

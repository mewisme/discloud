"use client"

import type { RecentActivityPage } from "@discloud/api/models"
import { RecentActivityView } from "@discloud/app-ui/activity/recent-activity"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useWorkspace } from "@/components/app/workspace-context"
import { PaginationTrigger } from "@/components/common/pagination-trigger"
import { apiJSON } from "@/lib/api/client"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: RecentActivityPage["items"]; nextCursor?: RecentActivityPage["nextCursor"] }

export function ActivityView() {
  const router = useRouter()
  const workspace = useWorkspace()
  const [state, setState] = useState<State>({ status: "loading" })
  const [retry, setRetry] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: "loading" })
    apiJSON<RecentActivityPage>("/api/v1/activity", { query: { ownerId: workspace.id, limit: 30 }, signal: controller.signal }).then((page) => { if (!controller.signal.aborted) setState({ status: "ready", items: page.items, nextCursor: page.nextCursor }) }).catch((cause) => {
      if (controller.signal.aborted) return
      if (cause instanceof APIError && cause.status === 401) { router.replace("/login"); router.refresh(); return }
      setState({ status: "error", message: apiErrorMessage(cause, "Could not load recent activity") })
    })
    return () => controller.abort()
  }, [retry, router, workspace.id])

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return
    const items = state.items
    const cursor = state.nextCursor
    setLoadingMore(true)
    try {
      const page = await apiJSON<RecentActivityPage>("/api/v1/activity", { query: { ownerId: workspace.id, limit: 30, beforeAt: cursor.beforeAt, beforeId: cursor.beforeId } })
      setState({ status: "ready", items: [...items, ...page.items], nextCursor: page.nextCursor })
    } catch (cause) { throw new Error(apiErrorMessage(cause, "Could not load recent activity"), { cause }) }
    finally { setLoadingMore(false) }
  }

  if (state.status === "loading") return <Loading />
  if (state.status === "error") return <ErrorState message={state.message} onRetry={() => setRetry((value) => value + 1)} />
  const cursor = state.nextCursor
  const pagination = cursor ? <PaginationTrigger loadKey={`${cursor.beforeAt}:${cursor.beforeId}`} hasMore loading={loadingMore} onLoadMore={loadMore} loadingLabel="Loading more activity…" /> : null
  return <RecentActivityView username={workspace.username} items={state.items} pagination={pagination} renderLink={({ href, className, children }) => <Link href={href} className={className}>{children}</Link>} />
}

function Loading() { return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Loading activity…</div></div> }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><div><p className="font-medium">Recent activity unavailable</p><p className="mt-1 text-sm text-muted-foreground">{message}</p></div><Button size="sm" variant="outline" onClick={onRetry}><RefreshCwIcon />Try again</Button></div></div> }

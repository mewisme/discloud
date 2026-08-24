"use client"

import type { StorageAnalyzerSnapshot } from "@discloud/api/models"
import { StorageAnalyzerView } from "@discloud/app-ui/storage/storage-analyzer"
import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useWorkspace } from "@/components/app/workspace-context"
import { apiJSON } from "@/lib/api/client"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: StorageAnalyzerSnapshot }

export function StorageView() {
  const router = useRouter()
  const workspace = useWorkspace()
  const [state, setState] = useState<State>({ status: "loading" })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setState({ status: "loading" })
      try {
        const data = await apiJSON<StorageAnalyzerSnapshot>("/api/v1/storage/analyzer", { query: { ownerId: workspace.id }, signal: controller.signal })
        if (!controller.signal.aborted) setState({ status: "ready", data })
      } catch (cause) {
        if (controller.signal.aborted) return
        if (cause instanceof APIError && cause.status === 401) { router.replace("/login"); router.refresh(); return }
        setState({ status: "error", message: apiErrorMessage(cause, "Could not analyze storage") })
      }
    }
    void load()
    return () => controller.abort()
  }, [retry, router, workspace.id])

  if (state.status === "loading") return <div className="grid min-h-64 place-items-center rounded-xl border"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Analyzing storage…</div></div>
  if (state.status === "error") return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><div><p className="font-medium">Storage analyzer unavailable</p><p className="mt-1 text-sm text-muted-foreground">{state.message}</p></div><Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}><RefreshCwIcon />Try again</Button></div></div>
  return <StorageAnalyzerView username={workspace.username} data={state.data} renderLink={({ href, className, children }) => <Link href={href} className={className}>{children}</Link>} />
}

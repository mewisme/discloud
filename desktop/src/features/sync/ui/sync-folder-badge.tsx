import type { BrowserNode } from "@discloud/api/models"
import { Badge } from "@discloud/ui/components/badge"
import { Loader2Icon } from "lucide-react"

import { useDesktopSync } from "./sync-provider"

export function DesktopSyncFolderBadge({ node }: { node: BrowserNode }) {
  const sync = useDesktopSync()
  if (node.kind !== "folder") return null
  const pair = sync.pairs.find((item) => item.remoteFolderId === node.id)
  if (!pair) return null
  const runtime = sync.runtimes[pair.id]
  if (!pair.enabled) return <Badge variant="outline" className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">Paused</Badge>
  if (runtime?.status === "syncing") return <Badge variant="secondary" className="shrink-0 gap-1 px-1.5 py-0 text-[10px]"><Loader2Icon className="size-2.5 animate-spin" />Syncing</Badge>
  if (runtime?.status === "error") return <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">Error</Badge>
  return <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">Active</Badge>
}

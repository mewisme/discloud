import "client-only"

import { apiJSON } from "@/lib/api/client"
import type { Node } from "@/lib/api/models"

export function setNodeFavorite(nodeId: string, favorite: boolean) {
  return apiJSON<Node>(`/api/v1/nodes/${encodeURIComponent(nodeId)}/favorite`, {
    method: favorite ? "PUT" : "DELETE",
  })
}
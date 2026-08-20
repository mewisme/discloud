import type { CurrentUserUsage, Node } from "@/lib/api/models"

export type Workspace = {
  owner: {
    id: string
    username: string
  }
  root: Node
  usage: CurrentUserUsage
}
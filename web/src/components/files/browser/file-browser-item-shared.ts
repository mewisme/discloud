import { browserNodeSizeLabel, browserNodeType } from "@discloud/app-ui/files/file-browser"

import type { BrowserNode, Node, NodePage } from "@/lib/api/models"
import type { BrowserOptions } from "@/lib/files/browser"

export type BrowserItemsProps = {
  nodes: BrowserNode[]
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
  options: BrowserOptions
  selected: ReadonlySet<string>
  loading: boolean
  favoritePending: boolean
  onMoveTargets: (nodes: readonly BrowserNode[]) => void
  onTrashTargets: (nodes: readonly BrowserNode[]) => void
  onFavoriteTargets: (nodes: readonly BrowserNode[], favorite: boolean) => Promise<void>
  onNavigate: (folderId: string) => void
  onSelect: (nodeId: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onFavorite: (node: BrowserNode, favorite: boolean) => Promise<void>
  onMoved: (nodeId: string) => void
  onReload: () => Promise<void>
}

export type BrowserItemsViewProps = BrowserItemsProps & { parent?: Node }

export { browserNodeSizeLabel, browserNodeType }

export function browserContextTargets(props: BrowserItemsProps, node: BrowserNode) {
  if (!props.selected.has(node.id)) return [node]
  const targets = props.nodes.filter((item) => props.selected.has(item.id))
  return targets.length ? targets : [node]
}
import type { BrowserNode, Node, NodePage } from "@/lib/api/models"
import type { BrowserOptions } from "@/lib/files/browser"
import { formatBytes } from "@/lib/helpers"

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

export type BrowserItemsViewProps = BrowserItemsProps & {
  parent?: Node
}

export function browserNodeType(node: BrowserNode) {
  if (node.kind === "folder") return "Folder"
  if (node.category) return node.category.charAt(0).toUpperCase() + node.category.slice(1)
  return node.mimeType || "File"
}

export function browserNodeSizeLabel(node: BrowserNode) {
  if (node.kind === "folder" || node.size == null) return "-"
  return formatBytes(node.size)
}

export function browserContextTargets(props: BrowserItemsProps, node: BrowserNode) {
  if (!props.selected.has(node.id)) return [node]
  const targets = props.nodes.filter((item) => props.selected.has(item.id))
  return targets.length ? targets : [node]
}
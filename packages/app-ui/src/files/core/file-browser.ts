import type { BrowserNode, Node } from "@discloud/api/models"
import type { BrowserView } from "@discloud/shared/file-browser"
import { formatBytes } from "@discloud/shared/format"
import type { ReactElement, ReactNode } from "react"

export type FileBrowserSelection = {
  selected: ReadonlySet<string>
  onSelect: (nodeId: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
}

export type FileBrowserNodeVisualRenderer = (node: BrowserNode, className?: string, iconClassName?: string) => ReactNode
export type FileBrowserNodeActionsRenderer = (node: BrowserNode) => ReactNode
export type FileBrowserNodeStatusRenderer = (node: BrowserNode) => ReactNode
export type FileBrowserModifiedRenderer = (node: BrowserNode) => ReactNode
export type FileBrowserNodeWrapper = (node: BrowserNode, children: ReactElement) => ReactNode

export type FileBrowserViewProps = {
  nodes: readonly BrowserNode[]
  parent?: Node
  selection?: FileBrowserSelection
  folderHref: (folderId: string, isRoot?: boolean) => string
  fileHref: (fileId: string) => string
  onNavigateFolder: (folderId: string, isRoot?: boolean) => void
  onOpenFile: (fileId: string) => void
  renderNodeVisual?: FileBrowserNodeVisualRenderer
  renderNodeActions?: FileBrowserNodeActionsRenderer
  renderNodeStatus?: FileBrowserNodeStatusRenderer
  renderModified?: FileBrowserModifiedRenderer
  wrapNode?: FileBrowserNodeWrapper
}

export type FileBrowserItemsProps = Omit<FileBrowserViewProps, "parent"> & {
  folder: Node
  breadcrumbs: readonly Node[]
  view: BrowserView
  loading?: boolean
  emptyDescription?: string
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
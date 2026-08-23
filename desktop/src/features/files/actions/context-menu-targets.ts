export function contextMenuTargets<T extends { id: string }>(node: T, selected: ReadonlySet<string>, selectedNodes: readonly T[]): readonly T[] {
  return selected.has(node.id) && selectedNodes.length ? selectedNodes : [node]
}

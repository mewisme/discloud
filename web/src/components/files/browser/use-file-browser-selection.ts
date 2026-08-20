"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { toast } from "sonner"

import type { BrowserNode } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { setNodeFavorite } from "@/lib/files/favorite"

export function useFileBrowserSelection({
  nodes,
  resetVersion,
  tableLoading,
  updateNodes,
}: {
  nodes: BrowserNode[]
  resetVersion: number
  tableLoading: boolean
  updateNodes: (updater: (nodes: BrowserNode[]) => BrowserNode[]) => void
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [favoritePending, setFavoritePending] = useState(false)
  const [moveTargets, setMoveTargets] = useState<BrowserNode[]>()
  const [trashTargets, setTrashTargets] = useState<BrowserNode[]>()

  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  const bulkEditable = selectedNodes.length > 0
    && selectedNodes.every((node) => node.accessLevel !== "view")
  const bulkSameOwner = selectedNodes.length > 0
    && selectedNodes.every(
      (node) => node.ownerUserId === selectedNodes[0].ownerUserId,
    )
  const bulkCanMove = bulkEditable && bulkSameOwner
  const bulkCanTrash = bulkEditable
  const bulkCanFavorite = selectedNodes.some(
    (node) => node.canFavorite && !node.isFavorite,
  )
  const bulkCanUnfavorite = selectedNodes.some(
    (node) => node.canFavorite && node.isFavorite,
  )
  const shortcutsEnabled = !moveTargets
    && !trashTargets
    && !favoritePending
    && !tableLoading

  const select = useCallback((nodeId: string, value: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (value) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
  }, [])

  const selectAll = useCallback((value: boolean) => {
    setSelected(value ? new Set(nodes.map((node) => node.id)) : new Set())
  }, [nodes])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
  }, [])

  const setFavorite = useCallback(async (
    node: BrowserNode,
    favorite: boolean,
  ) => {
    updateNodes((current) => (
      current.map((item) => (
        item.id === node.id ? { ...item, isFavorite: favorite } : item
      ))
    ))

    try {
      await setNodeFavorite(node.id, favorite)
    } catch (error) {
      updateNodes((current) => (
        current.map((item) => (
          item.id === node.id
            ? { ...item, isFavorite: node.isFavorite }
            : item
        ))
      ))

      handleFavoriteError(
        error,
        router,
        favorite
          ? "Could not add to favorites"
          : "Could not remove from favorites",
      )
    }
  }, [router, updateNodes])

  const setNodesFavorite = useCallback(async (
    source: readonly BrowserNode[],
    favorite: boolean,
  ) => {
    const targets = source.filter(
      (node) => node.canFavorite && node.isFavorite !== favorite,
    )

    if (!targets.length || favoritePending) return

    setFavoritePending(true)

    const previous = new Map(
      targets.map((node) => [node.id, node.isFavorite]),
    )

    updateNodes((current) => (
      current.map((node) => (
        previous.has(node.id) ? { ...node, isFavorite: favorite } : node
      ))
    ))

    const failures = new Set<string>()
    const errors: unknown[] = []

    for (let index = 0; index < targets.length; index += 8) {
      const batch = targets.slice(index, index + 8)
      const results = await Promise.allSettled(
        batch.map((node) => setNodeFavorite(node.id, favorite)),
      )

      results.forEach((result, offset) => {
        if (result.status === "rejected") {
          failures.add(batch[offset].id)
          errors.push(result.reason)
        }
      })
    }

    if (failures.size) {
      updateNodes((current) => (
        current.map((node) => (
          failures.has(node.id)
            ? {
              ...node,
              isFavorite: previous.get(node.id) ?? node.isFavorite,
            }
            : node
        ))
      ))

      if (errors.some(
        (error) => error instanceof APIError && error.status === 401,
      )) {
        router.replace("/login")
        router.refresh()
      } else {
        toast.error(
          `${failures.size} item${failures.size === 1 ? "" : "s"} could not be updated`,
        )
      }
    } else {
      toast.success(
        favorite ? "Added to favorites" : "Removed from favorites",
      )
    }

    setFavoritePending(false)
  }, [favoritePending, router, updateNodes])

  useEffect(() => {
    setSelected(new Set())
  }, [resetVersion])

  useEffect(() => {
    const valid = new Set(nodes.map((node) => node.id))

    setSelected((current) => {
      const next = new Set(
        [...current].filter((id) => valid.has(id)),
      )

      return next.size === current.size ? current : next
    })
  }, [nodes])

  useHotkeys(["ctrl+a", "meta+a"], () => selectAll(true), {
    enabled: shortcutsEnabled && nodes.length > 0,
    preventDefault: true,
  }, [nodes, selectAll, shortcutsEnabled])

  useHotkeys("esc", clearSelection, {
    enabled: shortcutsEnabled && selectedNodes.length > 0,
  }, [clearSelection, selectedNodes.length, shortcutsEnabled])

  useHotkeys("delete", () => setTrashTargets([...selectedNodes]), {
    enabled: shortcutsEnabled && bulkCanTrash,
    preventDefault: true,
  }, [bulkCanTrash, selectedNodes, shortcutsEnabled])

  return {
    selected,
    selectedNodes,
    favoritePending,
    moveTargets,
    trashTargets,
    bulkCanMove,
    bulkCanTrash,
    bulkCanFavorite,
    bulkCanUnfavorite,
    shortcutsEnabled,
    select,
    selectAll,
    clearSelection,
    setFavorite,
    setNodesFavorite,
    setMoveTargets,
    setTrashTargets,
  }
}

function handleFavoriteError(
  error: unknown,
  router: ReturnType<typeof useRouter>,
  fallback: string,
) {
  if (error instanceof APIError && error.status === 401) {
    router.replace("/login")
    router.refresh()
    return
  }

  toast.error(error instanceof APIError ? error.message : fallback)
}
"use client"

import { FilePlusIcon, Loader2Icon, SearchIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { FileTypeIcon } from "@/components/files/file-type-icon"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { apiJSON } from "@/lib/api/client"
import type { AddCollectionItemInput, CollectionItem, SearchPage, SearchQuery, SearchResult } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export function AddCollectionItemDialog({
  collectionId,
  existingItems,
  onAdded,
}: {
  collectionId: string
  existingItems: readonly CollectionItem[]
  onAdded: () => Promise<void>
}) {
  const workspace = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string>()
  const existing = useMemo(
    () => new Set(existingItems.map((item) => item.fileId)),
    [existingItems],
  )

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setLoading(true)

      try {
        const q = query.trim()
        const searchQuery: SearchQuery = {
          q: q || undefined,
          ownerId: workspace.id,
          kind: "file",
          sort: q ? "relevance" : "updated",
          order: "desc",
          limit: 25,
        }

        const page = await apiJSON<SearchPage>("/api/v1/search", {
          query: searchQuery,
          signal: controller.signal,
        })

        setResults(page.results.filter((item) => !!item.parentId))
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(apiErrorMessage(error, "Could not search files"))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 300)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [open, query, workspace.id])

  async function add(fileId: string) {
    setPendingId(fileId)

    try {
      const input: AddCollectionItemInput = { fileId }
      const result = await apiJSON<{ created: boolean }>(
        `/api/v1/collections/${collectionId}/items`,
        { method: "POST", body: input },
      )

      await onAdded()
      toast.success(
        result.created
          ? "File added"
          : "File is already in this collection",
      )
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not add file"))
    } finally {
      setPendingId(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FilePlusIcon />
          Add files
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add files</DialogTitle>
          <DialogDescription>
            Choose files from @{workspace.username}&apos;s workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            autoFocus
            placeholder="Search files…"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {loading ? (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2Icon className="size-4 animate-spin" />
                Searching…
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">
              No files found.
            </div>
          ) : (
            <div className="divide-y">
              {results.map((item) => {
                const added = existing.has(item.id)

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3"
                  >
                    <FileTypeIcon
                      category={item.category}
                      className="size-4 shrink-0"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.name}
                      </p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {item.category || item.mimeType || "File"}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={added || pendingId === item.id}
                      onClick={() => void add(item.id)}
                    >
                      {pendingId === item.id && (
                        <Loader2Icon className="animate-spin" />
                      )}
                      {added ? "Added" : "Add"}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
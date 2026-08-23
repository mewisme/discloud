"use client"

import { startThemeTransition } from "@discloud/shared/theme-transition"
import { Button } from "@discloud/ui/components/button"
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@discloud/ui/components/command"
import { FolderIcon, FolderPlusIcon, HeartIcon, LibraryIcon, Loader2Icon, MoonIcon, SearchIcon, SettingsIcon, Share2Icon, ShieldIcon, SunIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { useCurrentUser } from "@/components/app/current-user-context"
import { useWorkspace } from "@/components/app/workspace-context"
import { apiJSON } from "@/lib/api/client"
import type { SearchPage, SearchQuery, SearchResult } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { FILE_BROWSER_CREATE_FOLDER_EVENT, FILE_BROWSER_UPLOAD_EVENT } from "@/lib/files/commands"
import { folderBrowserPath, folderIdFromBrowserPath, workspacePath } from "@/lib/files/navigation"

export function CommandPalette() {
  const router = useRouter()
  const pathname = usePathname()
  const { resolvedTheme, setTheme } = useTheme()
  const user = useCurrentUser()
  const workspace = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [folders, setFolders] = useState<SearchResult[]>([])
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderError, setFolderError] = useState(false)
  const value = query.trim()
  const inFileBrowser = folderIdFromBrowserPath(pathname, workspace.username) !== null
  const dark = resolvedTheme === "dark"

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      setOpen((current) => !current)
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    if (!open || value.length < 2) {
      setFolders([])
      setFolderLoading(false)
      setFolderError(false)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setFolderLoading(true)
      setFolderError(false)

      try {
        const searchQuery = {
          q: value,
          ownerId: workspace.id,
          kind: "folder",
          sort: "relevance",
          order: "desc",
          limit: 8,
        } satisfies SearchQuery

        const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery, signal: controller.signal })
        setFolders([...page.results].filter((result) => result.kind === "folder"))
      } catch (error) {
        if (controller.signal.aborted) return

        if (error instanceof APIError && error.status === 401) {
          router.replace("/login")
          router.refresh()
          return
        }

        setFolders([])
        setFolderError(true)
      } finally {
        if (!controller.signal.aborted) setFolderLoading(false)
      }
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [open, router, value, workspace.id])

  function close() {
    setOpen(false)
    setQuery("")
    setFolders([])
    setFolderError(false)
  }

  function navigate(href: string) {
    close()
    router.push(href)
  }

  function searchFiles() {
    const params = new URLSearchParams()
    if (value) params.set("q", value)

    const base = workspacePath(workspace.username, "search")
    navigate(params.size ? `${base}?${params}` : base)
  }

  function browserCommand(eventName: string) {
    close()
    window.dispatchEvent(new Event(eventName))
  }

  function toggleTheme() {
    close()

    requestAnimationFrame(() => {
      startThemeTransition(() => setTheme(dark ? "light" : "dark"))
    })
  }

  return (
    <>
      <Button variant="outline" className="h-8 w-full justify-start gap-2 px-2.5 text-muted-foreground" onClick={() => setOpen(true)}>
        <SearchIcon className="size-3.5" />
        <span className="min-w-0 flex-1 truncate text-left text-xs sm:text-sm">Search or run a command…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) close()
        }}
        title="DisCloud command palette"
        description="Search files, open folders, navigate, or run workspace commands."
        className="sm:max-w-xl"
      >
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search files, folders, or commands…" />

          <CommandList>
            <CommandGroup heading="Search">
              <CommandItem onSelect={searchFiles}>
                <SearchIcon />
                {value ? `Search files for “${value}”` : "Search files"}
                <CommandShortcut>Enter</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            {value.length >= 2 && (
              <CommandGroup heading={`Go to folder · ${workspace.name}'s workspace`}>
                {folderLoading && (
                  <CommandItem disabled>
                    <Loader2Icon className="animate-spin" />
                    Searching folders…
                  </CommandItem>
                )}
                {!folderLoading && folderError && <CommandItem disabled>Folder search unavailable</CommandItem>}
                {!folderLoading && !folderError && folders.length === 0 && <CommandItem disabled>No matching folders</CommandItem>}
                {!folderLoading && folders.map((folder) => (
                  <CommandItem
                    key={folder.id}
                    value={`folder:${folder.id}:${folder.name}`}
                    onSelect={() => navigate(folderBrowserPath(workspace.username, folder.id))}
                  >
                    <FolderIcon />
                    <span className="truncate">{folder.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {inFileBrowser && (
              <CommandGroup heading="Current folder">
                <CommandItem onSelect={() => browserCommand(FILE_BROWSER_CREATE_FOLDER_EVENT)}>
                  <FolderPlusIcon />
                  New folder
                </CommandItem>
                <CommandItem onSelect={() => browserCommand(FILE_BROWSER_UPLOAD_EVENT)}>
                  <UploadIcon />
                  Upload files
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="Appearance">
              <CommandItem value="toggle-theme appearance light dark" onSelect={toggleTheme}>
                {dark ? <SunIcon /> : <MoonIcon />}
                {dark ? "Light mode" : "Dark mode"}
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => navigate(workspacePath(workspace.username))}>
                <FolderIcon />
                Files
              </CommandItem>
              <CommandItem onSelect={() => navigate(workspacePath(workspace.username, "favorites"))}>
                <HeartIcon />
                Favorites
              </CommandItem>
              <CommandItem onSelect={() => navigate(workspacePath(workspace.username, "collections"))}>
                <LibraryIcon />
                Collections
              </CommandItem>
              <CommandItem onSelect={() => navigate(workspacePath(workspace.username, "shared"))}>
                <Share2Icon />
                Shared
              </CommandItem>
              <CommandItem onSelect={() => navigate(workspacePath(workspace.username, "trash"))}>
                <Trash2Icon />
                Trash
              </CommandItem>
              <CommandItem onSelect={() => navigate(workspacePath(user.username, "settings"))}>
                <SettingsIcon />
                Settings
              </CommandItem>
              {user.role === "admin" && (
                <CommandItem onSelect={() => navigate(workspacePath(user.username, "admin"))}>
                  <ShieldIcon />
                  Admin
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
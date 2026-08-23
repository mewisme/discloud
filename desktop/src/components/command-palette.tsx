import type { SearchPage, SearchQuery, SearchResult, User, WorkspaceDetails } from "@discloud/api/models"
import { APIError } from "@discloud/api/types"
import { workspaceFolderIdFromPath, workspaceFolderPath, workspacePath } from "@discloud/shared/navigation"
import { startThemeTransition } from "@discloud/shared/theme-transition"
import { Button } from "@discloud/ui/components/button"
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@discloud/ui/components/command"
import { FolderIcon, FolderPlusIcon, HeartIcon, LibraryIcon, Loader2Icon, MoonIcon, SearchIcon, SettingsIcon, Share2Icon, ShieldIcon, SunIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { useDesktopSession } from "#components/desktop-session"
import { apiJSON } from "#lib/api/transport"

import { FILE_BROWSER_CREATE_FOLDER_EVENT, FILE_BROWSER_UPLOAD_EVENT } from "../features/files/commands"
import { loadDesktopWorkspace } from "../features/workspace/api"

type WorkspaceOwner = Pick<WorkspaceDetails["owner"], "id" | "username" | "name">

export function DesktopCommandPalette({ user, workspaceUsername }: { user: User; workspaceUsername: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const { refreshUser } = useDesktopSession()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [workspaceOwner, setWorkspaceOwner] = useState<WorkspaceOwner>()
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState(false)
  const [folders, setFolders] = useState<SearchResult[]>([])
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderError, setFolderError] = useState(false)
  const value = query.trim()
  const workspaceOwnerId = workspaceUsername === user.username ? user.id : workspaceOwner?.id
  const workspaceName = workspaceUsername === user.username ? user.name : workspaceOwner?.name ?? workspaceUsername
  const inFileBrowser = workspaceFolderIdFromPath(location.pathname, workspaceUsername) !== null
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
    let cancelled = false

    setWorkspaceError(false)

    if (workspaceUsername === user.username) {
      setWorkspaceOwner(undefined)
      setWorkspaceLoading(false)
      return
    }

    setWorkspaceOwner(undefined)
    setWorkspaceLoading(true)

    void loadDesktopWorkspace(workspaceUsername)
      .then((workspace) => {
        if (!cancelled) setWorkspaceOwner(workspace.owner)
      })
      .catch((error) => {
        if (cancelled) return

        if (error instanceof APIError && error.status === 401) {
          void refreshUser().catch(() => undefined)
          return
        }

        setWorkspaceError(true)
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [refreshUser, user.username, workspaceUsername])

  useEffect(() => {
    if (!open || value.length < 2) {
      setFolders([])
      setFolderLoading(false)
      setFolderError(false)
      return
    }

    if (!workspaceOwnerId) {
      setFolders([])
      setFolderLoading(false)
      setFolderError(workspaceError)
      return
    }

    let cancelled = false
    const timeout = setTimeout(async () => {
      setFolderLoading(true)
      setFolderError(false)

      try {
        const searchQuery = {
          q: value,
          ownerId: workspaceOwnerId,
          kind: "folder",
          sort: "relevance",
          order: "desc",
          limit: 8,
        } satisfies SearchQuery

        const page = await apiJSON<SearchPage>("/api/v1/search", { query: searchQuery })
        if (!cancelled) setFolders([...page.results].filter((result) => result.kind === "folder"))
      } catch (error) {
        if (cancelled) return

        if (error instanceof APIError && error.status === 401) {
          void refreshUser().catch(() => undefined)
          return
        }

        setFolders([])
        setFolderError(true)
      } finally {
        if (!cancelled) setFolderLoading(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [open, refreshUser, value, workspaceError, workspaceOwnerId])

  function close() {
    setOpen(false)
    setQuery("")
    setFolders([])
    setFolderError(false)
  }

  function go(href: string) {
    close()
    navigate(href)
  }

  function searchFiles() {
    const params = new URLSearchParams()
    if (value) params.set("q", value)

    const base = workspacePath(workspaceUsername, "search")
    go(params.size ? `${base}?${params}` : base)
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

            {value.length >= 2 ? (
              <CommandGroup heading={`Go to folder · ${workspaceName}'s workspace`}>
                {workspaceLoading ? (
                  <CommandItem disabled>
                    <Loader2Icon className="animate-spin" />
                    Loading workspace…
                  </CommandItem>
                ) : null}
                {!workspaceLoading && folderLoading ? (
                  <CommandItem disabled>
                    <Loader2Icon className="animate-spin" />
                    Searching folders…
                  </CommandItem>
                ) : null}
                {!workspaceLoading && !folderLoading && (workspaceError || folderError) ? <CommandItem disabled>Folder search unavailable</CommandItem> : null}
                {!workspaceLoading && !folderLoading && !workspaceError && !folderError && folders.length === 0 ? <CommandItem disabled>No matching folders</CommandItem> : null}
                {!workspaceLoading && !folderLoading && !workspaceError && !folderError ? folders.map((folder) => (
                  <CommandItem key={folder.id} value={`folder:${folder.id}:${folder.name}`} onSelect={() => go(workspaceFolderPath(workspaceUsername, folder.id))}>
                    <FolderIcon />
                    <span className="truncate">{folder.name}</span>
                  </CommandItem>
                )) : null}
              </CommandGroup>
            ) : null}

            {inFileBrowser ? (
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
            ) : null}

            <CommandGroup heading="Appearance">
              <CommandItem value="toggle-theme appearance light dark" onSelect={toggleTheme}>
                {dark ? <SunIcon /> : <MoonIcon />}
                {dark ? "Light mode" : "Dark mode"}
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => go(workspacePath(workspaceUsername))}>
                <FolderIcon />
                Files
              </CommandItem>
              <CommandItem onSelect={() => go(workspacePath(workspaceUsername, "favorites"))}>
                <HeartIcon />
                Favorites
              </CommandItem>
              <CommandItem onSelect={() => go(workspacePath(workspaceUsername, "collections"))}>
                <LibraryIcon />
                Collections
              </CommandItem>
              <CommandItem onSelect={() => go(workspacePath(workspaceUsername, "shared"))}>
                <Share2Icon />
                Shared
              </CommandItem>
              <CommandItem onSelect={() => go(workspacePath(workspaceUsername, "trash"))}>
                <Trash2Icon />
                Trash
              </CommandItem>
              <CommandItem onSelect={() => go(workspacePath(user.username, "settings"))}>
                <SettingsIcon />
                Settings
              </CommandItem>
              {user.role === "admin" ? (
                <CommandItem onSelect={() => go(workspacePath(user.username, "admin"))}>
                  <ShieldIcon />
                  Admin
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

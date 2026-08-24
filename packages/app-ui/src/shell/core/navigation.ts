import { workspacePath } from "@discloud/shared/navigation"
import {
  ActivityIcon,
  BotIcon,
  FolderIcon,
  HardDriveIcon,
  HeartIcon,
  HistoryIcon,
  LibraryIcon,
  SearchIcon,
  Share2Icon,
  ShieldIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import type { ComponentType } from "react"

export type AppNavItem = {
  title: string
  href: string
  icon: ComponentType<{ className?: string }>
  exact?: boolean
  match?: (pathname: string) => boolean
}

export type AppNavigation = {
  primary: AppNavItem[]
  library: AppNavItem[]
  administration: AppNavItem[]
}

export function createAppNavigation({
  actorUsername,
  workspaceUsername,
  isAdmin,
}: {
  actorUsername: string
  workspaceUsername: string
  isAdmin: boolean
}): AppNavigation {
  const workspaceRoot = workspacePath(workspaceUsername)

  return {
    primary: [
      {
        title: "Files",
        href: workspaceRoot,
        icon: FolderIcon,
        match: (pathname) =>
          pathname === workspaceRoot ||
          pathname === `${workspaceRoot}/` ||
          pathname.startsWith(`${workspaceRoot}/folders/`) ||
          pathname.startsWith(`${workspaceRoot}/files/`),
      },
      {
        title: "Search",
        href: workspacePath(workspaceUsername, "search"),
        icon: SearchIcon,
      },
      {
        title: "Uploads",
        href: workspacePath(actorUsername, "uploads"),
        icon: UploadIcon,
      },
    ],
    library: [
      {
        title: "Favorites",
        href: workspacePath(workspaceUsername, "favorites"),
        icon: HeartIcon,
      },
      {
        title: "Collections",
        href: workspacePath(workspaceUsername, "collections"),
        icon: LibraryIcon,
      },
      {
        title: "Shared",
        href: workspacePath(workspaceUsername, "shared"),
        icon: Share2Icon,
      },
      {
        title: "Activity",
        href: workspacePath(workspaceUsername, "activity"),
        icon: HistoryIcon,
      },
      {
        title: "Storage",
        href: workspacePath(workspaceUsername, "storage"),
        icon: HardDriveIcon,
      },
      {
        title: "Trash",
        href: workspacePath(workspaceUsername, "trash"),
        icon: Trash2Icon,
      },
    ],
    administration: isAdmin
      ? [
        {
          title: "Admin",
          href: workspacePath(actorUsername, "admin"),
          icon: ShieldIcon,
          exact: true,
        },
        {
          title: "Bots",
          href: workspacePath(actorUsername, "admin/bots"),
          icon: BotIcon,
        },
        {
          title: "Diagnostics",
          href: workspacePath(actorUsername, "admin/diagnostics"),
          icon: ActivityIcon,
        },
      ]
      : [],
  }
}

export function isAppNavItemActive(pathname: string, item: AppNavItem) {
  if (item.match) return item.match(pathname)

  if (item.exact) {
    return pathname === item.href || pathname === `${item.href}/`
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
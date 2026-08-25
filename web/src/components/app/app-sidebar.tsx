"use client"

import {
  type AppLinkRenderer,
  AppSidebarView,
} from "@discloud/app-ui/shell/app-sidebar"
import { createAppNavigation } from "@discloud/app-ui/shell/navigation"
import { Progress } from "@discloud/ui/components/progress"
import Link from "next/link"
import { usePathname } from "next/navigation"

import type { Workspace } from "@/components/app/workspace-context"
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher"
import { useUserConfig } from "@/components/settings/user-config-context"
import type { CurrentUserUsage, User } from "@/lib/api/models"
import { formatBytes } from "@/lib/helpers"

const renderNextLink: AppLinkRenderer = ({
  href,
  children,
  onNavigate,
}) => (
  <Link href={href} onClick={onNavigate}>
    {children}
  </Link>
)

export function AppSidebar({
  user,
  workspace,
  usage,
}: {
  user: User
  workspace: Workspace
  usage: CurrentUserUsage
}) {
  const pathname = usePathname()
  const { config } = useUserConfig()
  const sidebar = config.common.sidebar
  const navigation = createAppNavigation({
    actorUsername: user.username,
    workspaceUsername: workspace.username,
    isAdmin: user.role === "admin",
  })

  return (
    <AppSidebarView
      side={sidebar.side}
      variant={sidebar.variant}
      collapsible={sidebar.collapsible}
      pathname={pathname}
      primaryItems={navigation.primary}
      libraryItems={navigation.library}
      insightItems={navigation.insights}
      utilityItems={navigation.utility}
      administrationItems={navigation.administration}
      header={<WorkspaceSwitcher />}
      footer={
        <QuotaUsage
          username={workspace.username}
          usage={usage}
          showOwner={workspace.username !== user.username}
        />
      }
      renderLink={renderNextLink}
    />
  )
}

function QuotaUsage({
  username,
  usage,
  showOwner,
}: {
  username: string
  usage: CurrentUserUsage
  showOwner: boolean
}) {
  const committed = usage.usedBytes + usage.reservedBytes
  const percent = usage.quotaBytes === null
    ? 0
    : Math.min(
      100,
      usage.quotaBytes === 0
        ? 100
        : committed / usage.quotaBytes * 100,
    )

  return (
    <div className="mx-1 space-y-2 rounded-lg border bg-background p-2.5 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {showOwner ? `@${username} storage` : "Storage"}
        </span>

        {usage.quotaBytes !== null ? (
          <span className="tabular-nums text-muted-foreground">
            {Math.round(percent)}%
          </span>
        ) : null}
      </div>

      <div className="truncate text-xs tabular-nums text-muted-foreground">
        {formatBytes(usage.usedBytes)}

        {usage.reservedBytes > 0 ? (
          <span> (+{formatBytes(usage.reservedBytes)})</span>
        ) : null}

        <span>
          {" "} / {usage.quotaBytes === null
            ? "Unlimited"
            : formatBytes(usage.quotaBytes)}
        </span>
      </div>

      {usage.quotaBytes !== null ? (
        <Progress value={percent} />
      ) : null}

      {usage.overQuota ? (
        <div className="text-xs font-medium text-destructive">
          Quota exceeded
        </div>
      ) : null}
    </div>
  )
}
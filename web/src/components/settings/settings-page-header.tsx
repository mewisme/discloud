"use client"

import { useRouter } from "next/navigation"

import { useCurrentUser } from "@/components/app/current-user-context"
import { type CompactBreadcrumbItem, CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { workspacePath } from "@/lib/workspace/navigation"

export function SettingsPageHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  const router = useRouter()
  const user = useCurrentUser()
  const items: CompactBreadcrumbItem[] = [
    {
      id: "settings",
      label: "Settings",
      href: workspacePath(user.username, "settings"),
    },
    {
      id: title.toLowerCase(),
      label: title,
    },
  ]

  return (
    <div className="space-y-3">
      <CompactBreadcrumbs
        items={items}
        onNavigate={(item) => {
          if (item.href) router.push(item.href)
        }}
        separator="/"
      />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
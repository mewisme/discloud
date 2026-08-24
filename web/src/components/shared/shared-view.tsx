"use client"

import { SharedView as SharedItemsView } from "@discloud/app-ui/shared/shared-view"
import Link from "next/link"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateOnly } from "@/components/common/date-time"
import type { SharedItem } from "@/lib/api/models"
import { collectionPath, folderBrowserPath } from "@/lib/files/navigation"

export function SharedView({ items }: { items: readonly SharedItem[] }) {
  const workspace = useWorkspace()
  return <SharedItemsView items={items} renderLink={(item, className, children) => <Link href={itemHref(item, workspace.username)} className={className}>{children}</Link>} renderSharedAt={(item) => <DateOnly value={item.sharedAt} />} />
}
function itemHref(item: SharedItem, username: string) { return item.kind === "folder" ? folderBrowserPath(username, item.id) : collectionPath(username, item.id) }

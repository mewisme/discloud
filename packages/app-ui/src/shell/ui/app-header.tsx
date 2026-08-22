"use client"

import { Separator } from "@discloud/ui/components/separator"
import { SidebarTrigger } from "@discloud/ui/components/sidebar"
import type { ReactNode } from "react"

export function AppHeaderView({
  title,
  center,
  actions,
}: {
  title: string
  center?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-8" />

        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline lg:max-w-64">
          {title}
        </span>
      </div>

      {center ? (
        <div className="pointer-events-none fixed left-1/2 top-2 z-30 w-[calc(100vw-10rem)] max-w-md -translate-x-1/2 sm:w-[min(28rem,calc(100vw-18rem))] lg:w-[min(32rem,calc(100vw-24rem))]">
          <div className="pointer-events-auto">{center}</div>
        </div>
      ) : null}

      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
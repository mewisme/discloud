"use client"

import { Button } from "@discloud/ui/components/button"
import {
  SidebarInset,
  SidebarProvider,
} from "@discloud/ui/components/sidebar"
import { TooltipProvider } from "@discloud/ui/components/tooltip"
import { cn } from "@discloud/ui/lib/utils"
import type { ReactNode } from "react"

export function AppShellFrame({
  sidebar,
  header,
  children,
  defaultSidebarOpen = true,
  sidebarOnRight = false,
}: {
  sidebar: ReactNode
  header: ReactNode
  children: ReactNode
  defaultSidebarOpen?: boolean
  sidebarOnRight?: boolean
}) {
  return (
    <TooltipProvider>
      <SidebarProvider
        defaultOpen={defaultSidebarOpen}
        className={sidebarOnRight ? "flex-row-reverse" : undefined}
      >
        <Button
          asChild
          size="sm"
          variant="secondary"
          className="fixed left-3 top-3 z-50 -translate-y-20 shadow-lg transition-transform focus:translate-y-0"
        >
          <a href="#main-content">Skip to content</a>
        </Button>

        {sidebar}

        <SidebarInset
          className={cn(
            "md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-t-none",
            sidebarOnRight &&
            "md:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:mr-0",
          )}
        >
          {header}

          <div
            id="main-content"
            role="main"
            tabIndex={-1}
            className="flex flex-1 flex-col p-4 outline-none sm:p-6"
          >
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
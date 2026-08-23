"use client"

import { DockStackProvider } from "@discloud/app-ui/shell/dock-stack"
import { Toaster } from "@discloud/ui/components/sonner"
import { TooltipProvider } from "@discloud/ui/components/tooltip"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"

import { NetworkStatus } from "@/components/app/network-status"
import { RouteFocusManager } from "@/components/app/route-focus-manager"

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <DockStackProvider>
          {children}
          <RouteFocusManager />
          <NetworkStatus />
        </DockStackProvider>
      </TooltipProvider>
      <Toaster richColors />
    </ThemeProvider>
  )
}

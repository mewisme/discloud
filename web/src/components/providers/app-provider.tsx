"use client"

import { DockStackProvider } from "@discloud/app-ui/shell/dock-stack"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"

import { NetworkStatus } from "@/components/app/network-status"
import { RouteFocusManager } from "@/components/app/route-focus-manager"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

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

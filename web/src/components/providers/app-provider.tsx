"use client"

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
        {children}
      </TooltipProvider>
      <RouteFocusManager />
      <NetworkStatus />
      <Toaster richColors />
    </ThemeProvider>
  )
}
"use client"

import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"

import { NetworkStatus } from "@/components/app/network-status"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        {children}
      </TooltipProvider>
      <NetworkStatus />
      <Toaster closeButton richColors />
    </ThemeProvider>
  )
}
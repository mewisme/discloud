"use client"

import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useLayoutEffect } from "react"

import { useUserConfig } from "@/components/settings/user-config-context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { applyThemeTransitionEffect, removeThemeTransitionEffect, startThemeTransition } from "@/lib/theme-transition"

export function ModeToggle() {
  const { setTheme } = useTheme()
  const { config } = useUserConfig()
  const effect = config.common.theme.effect

  useLayoutEffect(() => {
    applyThemeTransitionEffect(effect)
    return removeThemeTransitionEffect
  }, [effect])

  function changeTheme(theme: "light" | "dark" | "system") {
    startThemeTransition(() => setTheme(theme))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Toggle theme">
          <SunIcon className="size-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <MoonIcon className="absolute size-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => changeTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => changeTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => changeTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
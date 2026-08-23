"use client"

import { applyThemeTransitionEffect, removeThemeTransitionEffect, startThemeTransition } from "@discloud/shared/theme-transition"
import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useLayoutEffect } from "react"

import { useUserConfig } from "@/components/settings/user-config-context"

export function ModeToggle() {
  const { setTheme } = useTheme()
  const { config } = useUserConfig()
  const { effect, custom } = config.common.theme

  useLayoutEffect(() => {
    applyThemeTransitionEffect(effect, custom.css)
    return removeThemeTransitionEffect
  }, [effect, custom.css])

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
        <DropdownMenuItem onClick={() => changeTheme("light")}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => changeTheme("dark")}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => changeTheme("system")}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
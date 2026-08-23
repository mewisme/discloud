import { applyThemeTransitionEffect, removeThemeTransitionEffect, startThemeTransition } from "@discloud/shared/theme-transition"
import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useLayoutEffect } from "react"

import { useDesktopUserConfig } from "../../settings/ui/user-config-provider"

export function DesktopModeToggle() {
  const { setTheme } = useTheme()
  const { config } = useDesktopUserConfig()
  const theme = config?.common.theme

  useLayoutEffect(() => {
    if (!theme) return
    applyThemeTransitionEffect(theme.effect, theme.custom.css)
    return removeThemeTransitionEffect
  }, [theme])

  function changeTheme(nextTheme: "light" | "dark" | "system") {
    startThemeTransition(() => setTheme(nextTheme))
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
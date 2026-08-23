import { RouterProvider } from "react-router/dom"

import { DesktopSessionProvider } from "#components/desktop-session"

import { DesktopContextMenuProvider } from "./features/desktop/ui/context-menu-provider"
import { DesktopRuntimeProvider } from "./features/desktop/ui/desktop-runtime-provider"
import { DesktopUpdaterProvider } from "./features/updater/ui/updater-provider"
import { router } from "./router"

export function App() {
  return (
    <DesktopRuntimeProvider>
      <DesktopUpdaterProvider>
        <DesktopSessionProvider>
          <DesktopContextMenuProvider>
            <RouterProvider router={router} />
          </DesktopContextMenuProvider>
        </DesktopSessionProvider>
      </DesktopUpdaterProvider>
    </DesktopRuntimeProvider>
  )
}

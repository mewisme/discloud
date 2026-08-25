import { Toaster } from "@discloud/ui/components/sonner"
import { RouterProvider } from "react-router/dom"

import { DesktopSessionProvider } from "#components/desktop-session"
import { PreconnectionUpdater } from "#components/preconnection-updater"

import { DesktopContextMenuProvider } from "./features/desktop/ui/context-menu-provider"
import { DesktopRuntimeProvider } from "./features/desktop/ui/desktop-runtime-provider"
import { DesktopUpdaterProvider } from "./features/updater/ui/updater-provider"
import { router } from "./router"

export function App() {
  return (
    <DesktopRuntimeProvider>
      <DesktopUpdaterProvider>
        <DesktopSessionProvider>
          <PreconnectionUpdater />
          <DesktopContextMenuProvider>
            <RouterProvider router={router} />
          </DesktopContextMenuProvider>
        </DesktopSessionProvider>
      </DesktopUpdaterProvider>
      <Toaster position="bottom-right" />
    </DesktopRuntimeProvider>
  )
}

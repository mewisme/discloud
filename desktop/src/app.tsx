import { RouterProvider } from "react-router/dom"

import { DesktopSessionProvider } from "#components/desktop-session"

import { DesktopRuntimeProvider } from "./features/desktop/ui/desktop-runtime-provider"
import { router } from "./router"

export function App() {
  return (
    <DesktopRuntimeProvider>
      <DesktopSessionProvider>
        <RouterProvider router={router} />
      </DesktopSessionProvider>
    </DesktopRuntimeProvider>
  )
}

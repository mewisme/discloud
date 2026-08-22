import { RouterProvider } from "react-router/dom"

import { DesktopSessionProvider } from "#components/desktop-session"

import { router } from "./router"

export function App() {
  return (
    <DesktopSessionProvider>
      <RouterProvider router={router} />
    </DesktopSessionProvider>
  )
}
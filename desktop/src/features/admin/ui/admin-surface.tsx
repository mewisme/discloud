import { workspacePath } from "@discloud/shared/navigation"
import { lazy, type ReactNode, Suspense } from "react"

const DesktopAdminPage = lazy(() => import("./admin-page").then((module) => ({ default: module.DesktopAdminPage })))
const DesktopAdminBotsPage = lazy(() => import("./bots-page").then((module) => ({ default: module.DesktopAdminBotsPage })))
const DesktopAdminDiagnosticsPage = lazy(() => import("./diagnostics-page").then((module) => ({ default: module.DesktopAdminDiagnosticsPage })))

export function DesktopAdminSurface({ pathname, username }: { pathname: string; username: string }) {
  const admin = workspacePath(username, "admin")

  if (pathname === admin || pathname === `${admin}/`) return <RouteLoading><DesktopAdminPage /></RouteLoading>
  if (pathname === `${admin}/bots`) return <RouteLoading><DesktopAdminBotsPage /></RouteLoading>
  if (pathname === `${admin}/diagnostics`) return <RouteLoading><DesktopAdminDiagnosticsPage /></RouteLoading>
  return null
}

function RouteLoading({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="grid min-h-64 place-items-center text-sm text-muted-foreground">Loading administration</div>}>{children}</Suspense>
}

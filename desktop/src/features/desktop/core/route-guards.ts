import { workspacePath } from "@discloud/shared/navigation"

export type DesktopRouteUser = {
  username: string
  mustChangePassword: boolean
  role: string
}

export function connectedRouteTarget(state: { setupRequired: boolean; user: DesktopRouteUser | null }): string {
  if (state.setupRequired) return "/setup"
  if (!state.user) return "/login"
  return authenticatedPath(state.user)
}

export function authenticatedPath(user: Pick<DesktopRouteUser, "mustChangePassword" | "username">): string {
  return user.mustChangePassword ? "/change-password" : workspacePath(user.username)
}

export function actorRouteRedirect(authenticatedUsername: string, routeUsername: string, pathname: string): string | undefined {
  if (routeUsername === authenticatedUsername) return undefined
  const routeRoot = workspacePath(routeUsername)
  const suffix = pathname.startsWith(routeRoot + "/") ? pathname.slice(routeRoot.length) : ""
  return workspacePath(authenticatedUsername) + suffix
}

export function adminRouteRedirect(user: Pick<DesktopRouteUser, "role" | "username">): string | undefined {
  return user.role === "admin" ? undefined : workspacePath(user.username)
}

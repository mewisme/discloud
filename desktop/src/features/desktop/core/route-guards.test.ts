import { workspacePath } from "@discloud/shared/navigation"
import { describe, expect, it } from "vitest"

import { actorRouteRedirect, adminRouteRedirect, authenticatedPath, connectedRouteTarget, type DesktopRouteUser } from "./route-guards"

const user: DesktopRouteUser = { username: "mew", mustChangePassword: false, role: "user" }

describe("desktop route guards", () => {
  it("routes connected session states to setup, login, password change, or workspace", () => {
    expect(connectedRouteTarget({ setupRequired: true, user: null })).toBe("/setup")
    expect(connectedRouteTarget({ setupRequired: false, user: null })).toBe("/login")
    expect(connectedRouteTarget({ setupRequired: false, user: { ...user, mustChangePassword: true } })).toBe("/change-password")
    expect(connectedRouteTarget({ setupRequired: false, user })).toBe(workspacePath("mew"))
    expect(authenticatedPath(user)).toBe(workspacePath("mew"))
  })

  it("keeps actor-only routes on the authenticated user's workspace", () => {
    expect(actorRouteRedirect("mew", "mew", workspacePath("mew"))).toBeUndefined()
    expect(actorRouteRedirect("mew", "other", workspacePath("other") + "/settings/security")).toBe(workspacePath("mew") + "/settings/security")
    expect(actorRouteRedirect("mew", "other", "/unexpected")).toBe(workspacePath("mew"))
  })

  it("allows admins and redirects non-admin users away from admin routes", () => {
    expect(adminRouteRedirect({ ...user, role: "admin" })).toBeUndefined()
    expect(adminRouteRedirect(user)).toBe(workspacePath("mew"))
  })
})

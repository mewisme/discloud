import { workspacePath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { BugIcon, MonitorCogIcon, RocketIcon, ServerIcon } from "lucide-react"
import { Link, Outlet, useLocation, useParams } from "react-router"

const sections = [
  { suffix: "settings/desktop", title: "General", icon: MonitorCogIcon },
  { suffix: "settings/desktop/local-server", title: "Local Server", icon: ServerIcon },
  { suffix: "settings/desktop/updates", title: "Updates", icon: RocketIcon },
  { suffix: "settings/desktop/diagnostics", title: "Diagnostics", icon: BugIcon },
] as const

export function DesktopNativeSettingsPage() {
  const { username } = useParams()
  const { pathname } = useLocation()
  if (!username) return null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Desktop</h1>
        <p className="text-sm text-muted-foreground">Manage native behavior, Local server, updates and diagnostics for this device.</p>
      </div>

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Desktop settings">
        {sections.map((section, index) => {
          const path = workspacePath(username, section.suffix)
          const active = index === 0 ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)
          return (
            <Button key={section.suffix} asChild variant={active ? "secondary" : "outline"} className="justify-start">
              <Link to={path}><section.icon />{section.title}</Link>
            </Button>
          )
        })}
      </nav>

      <Outlet />
    </div>
  )
}

import { workspacePath } from "@discloud/shared/navigation"
import { Card, CardContent } from "@discloud/ui/components/card"
import { ChevronRightIcon, MonitorCogIcon, Settings2Icon, ShieldCheckIcon, UserRoundIcon } from "lucide-react"
import { Link, useParams } from "react-router"

const settings = [
  {
    suffix: "settings/profile",
    title: "Profile",
    description: "Manage your profile picture and account identity.",
    icon: UserRoundIcon,
  },
  {
    suffix: "settings/common",
    title: "Common",
    description: "Manage display, sidebar, pagination, preview and time zone preferences.",
    icon: Settings2Icon,
  },
  {
    suffix: "settings/desktop",
    title: "Desktop",
    description: "Manage native behavior, Local server, updates and diagnostics for this device.",
    icon: MonitorCogIcon,
  },
  {
    suffix: "settings/security",
    title: "Security",
    description: "Manage password, two-factor authentication and recovery codes.",
    icon: ShieldCheckIcon,
  },
] as const

export function DesktopSettingsPage() {
  const { username } = useParams()
  if (!username) return null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your DisCloud account and preferences.</p>
      </div>

      <div className="grid gap-3">
        {settings.map((item) => (
          <Card key={item.suffix} className="p-0">
            <CardContent className="p-0">
              <Link to={workspacePath(username, item.suffix)} className="flex items-center gap-4 rounded-xl p-4 transition-colors hover:bg-muted/50">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                  <item.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

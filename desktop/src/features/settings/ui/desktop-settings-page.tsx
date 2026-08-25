import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Switch } from "@discloud/ui/components/switch"
import { BellIcon, Loader2Icon, MonitorCogIcon, PowerIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { type ReactNode, useState } from "react"

import { useDesktopRuntime } from "../../desktop/ui/desktop-runtime-provider"
import { DesktopUpdaterSettings } from "../../updater/ui/update-settings-section"
import { DesktopDiagnosticsSettings } from "./desktop-diagnostics-settings"
import { LocalServerSettings } from "./local-server-settings"

export function DesktopNativeSettingsPage() {
  const runtime = useDesktopRuntime()
  const [pending, setPending] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [tested, setTested] = useState(false)

  async function run(key: string, action: () => Promise<void>) {
    if (pending) return

    setPending(key)
    setActionError(undefined)

    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Desktop setting action failed.")
    } finally {
      setPending(undefined)
    }
  }

  async function testNotification() {
    await run("test-notification", async () => {
      const sent = await runtime.testNotification()
      setTested(sent)
      if (!sent) throw new Error("Notification permission was not granted by the operating system.")
    })
  }

  if (runtime.loading && !runtime.preferences) {
    return (
      <div className="grid min-h-64 place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="animate-spin" />
          Loading desktop settings
        </div>
      </div>
    )
  }

  if (!runtime.preferences) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-3xl">
        <TriangleAlertIcon />
        <AlertTitle>Desktop settings unavailable</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{runtime.error ?? "Could not load desktop settings."}</p>
          <Button size="sm" variant="outline" onClick={runtime.reload}><RefreshCwIcon />Try again</Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Desktop</h1>
        <p className="text-sm text-muted-foreground">Configure native desktop behavior for this device.</p>
      </div>

      {actionError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Desktop action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PowerIcon className="size-4" />Startup and tray</CardTitle>
          <CardDescription>Control how DisCloud behaves with your operating system.</CardDescription>
        </CardHeader>

        <CardContent>
          <SettingRow title="Launch at startup" description="Start DisCloud automatically after signing in to the operating system. Autostart launches hidden in the tray.">
            <Switch checked={runtime.autostartEnabled} disabled={!!pending} onCheckedChange={(enabled) => void run("autostart", () => runtime.setAutostart(enabled))} />
          </SettingRow>

          <SettingRow title="Close to tray" description="Hide the main window instead of exiting when the window close button is pressed." last>
            <Switch checked={runtime.preferences.closeToTray} disabled={!!pending} onCheckedChange={(enabled) => void run("close-to-tray", () => runtime.setCloseToTray(enabled))} />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellIcon className="size-4" />Notifications</CardTitle>
          <CardDescription>Show native operating-system notifications for background activity.</CardDescription>
        </CardHeader>

        <CardContent>
          <SettingRow title="Upload notifications" description="Notify when an upload batch completes or when a new upload failure needs attention.">
            <Switch checked={runtime.preferences.notifications} disabled={!!pending} onCheckedChange={(enabled) => void run("notifications", () => runtime.setNotifications(enabled))} />
          </SettingRow>

          <SettingRow title="Operating-system permission" description="DisCloud can only display notifications after the operating system grants permission." last>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge variant={runtime.notificationPermissionGranted ? "default" : "secondary"}>{runtime.notificationPermissionGranted ? "Granted" : "Not granted"}</Badge>
              <Button size="sm" variant="outline" disabled={!!pending} onClick={() => void testNotification()}>
                {pending === "test-notification" ? <Loader2Icon className="animate-spin" /> : <BellIcon />}
                Test notification
              </Button>
              {tested ? <span className="text-xs text-muted-foreground">Sent.</span> : null}
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MonitorCogIcon className="size-4" />Native runtime</CardTitle>
          <CardDescription>Core desktop integration enabled for every DisCloud session on this device.</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-3 sm:grid-cols-2">
          <RuntimeStatus title="System tray" description="Show, hide and quit DisCloud from the native tray menu." />
          <RuntimeStatus title="Single instance" description="Opening DisCloud again focuses the existing window instead of starting another process." />
        </CardContent>
      </Card>

      <LocalServerSettings />

      <DesktopDiagnosticsSettings />

      <DesktopUpdaterSettings />
    </div>
  )
}

function SettingRow({ title, description, children, last = false }: { title: string; description: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${last ? "" : "border-b"} first:pt-0 last:pb-0`}>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="sm:flex sm:justify-end">{children}</div>
    </div>
  )
}

function RuntimeStatus({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{title}</p>
        <Badge>Enabled</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

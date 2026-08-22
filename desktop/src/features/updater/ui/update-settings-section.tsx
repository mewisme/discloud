import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Progress } from "@discloud/ui/components/progress"
import { Switch } from "@discloud/ui/components/switch"
import { CheckCircle2Icon, DownloadIcon, Loader2Icon, RefreshCwIcon, RocketIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"

import { useDesktopUpdater } from "./updater-provider"

export function DesktopUpdaterSettings() {
  const updater = useDesktopUpdater()
  const busy = updater.stage === "checking" || updater.stage === "downloading" || updater.stage === "installing"
  const progress = updater.totalBytes && updater.totalBytes > 0
    ? Math.min(100, updater.downloadedBytes / updater.totalBytes * 100)
    : undefined

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Updates</h2>
        <p className="text-sm text-muted-foreground">Check for signed DisCloud desktop releases and install them without leaving the app.</p>
      </div>

      {updater.error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Update action failed</AlertTitle>
          <AlertDescription>{updater.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2"><RocketIcon className="size-4" />DisCloud Desktop</CardTitle>
              <CardDescription>Updates are verified with the public signing key bundled into this application.</CardDescription>
            </div>
            <UpdateStatusBadge stage={updater.stage} />
          </div>
        </CardHeader>

        <CardContent>
          <SettingRow title="Installed version" description="The version currently running on this device.">
            <code className="rounded-md bg-muted px-2 py-1 text-sm">{updater.currentVersion ? `v${updater.currentVersion}` : "Loading..."}</code>
          </SettingRow>

          <SettingRow title="Check automatically" description="Check the configured update endpoint once when a packaged DisCloud app starts.">
            <Switch checked={updater.preferences?.checkOnStartup ?? true} disabled={!updater.preferences || busy} onCheckedChange={(enabled) => void updater.setCheckOnStartup(enabled)} />
          </SettingRow>

          <SettingRow title="Check now" description={updater.lastCheckedAt ? `Last checked ${formatDateTime(updater.lastCheckedAt)}.` : "No update check has completed in this process yet."} last>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void updater.checkForUpdates()}>
              {updater.stage === "checking" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              {updater.stage === "checking" ? "Checking..." : "Check for updates"}
            </Button>
          </SettingRow>
        </CardContent>
      </Card>

      {updater.stage === "up-to-date" ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>DisCloud is up to date</AlertTitle>
          <AlertDescription>You are running the latest release available for this platform.</AlertDescription>
        </Alert>
      ) : null}

      {updater.update ? (
        <Card>
          <CardHeader>
            <CardTitle>Version {updater.update.version}</CardTitle>
            <CardDescription>
              Update from v{updater.update.currentVersion}
              {updater.update.date ? ` · released ${formatReleaseDate(updater.update.date)}` : ""}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {updater.update.body ? (
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="mb-2 text-sm font-medium">Release notes</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{updater.update.body}</p>
              </div>
            ) : null}

            {updater.stage === "downloading" || updater.stage === "installing" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{updater.stage === "installing" ? "Installing update" : "Downloading update"}</span>
                  {progress !== undefined ? <span className="tabular-nums text-muted-foreground">{Math.round(progress)}%</span> : null}
                </div>
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  {updater.stage === "installing"
                    ? "DisCloud will relaunch when installation finishes."
                    : updater.totalBytes
                      ? `${formatBytes(updater.downloadedBytes)} / ${formatBytes(updater.totalBytes)}`
                      : `${formatBytes(updater.downloadedBytes)} downloaded`}
                </p>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={busy} onClick={() => void updater.installUpdate()}>
                {busy ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                {updater.stage === "downloading"
                  ? "Downloading..."
                  : updater.stage === "installing"
                    ? "Installing..."
                    : "Download and install"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {import.meta.env.DEV ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Development build</AlertTitle>
          <AlertDescription>Updater checks are designed for packaged builds. Use a signed release build when validating the full install and relaunch flow.</AlertDescription>
        </Alert>
      ) : null}
    </section>
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

function UpdateStatusBadge({ stage }: { stage: ReturnType<typeof useDesktopUpdater>["stage"] }) {
  switch (stage) {
    case "checking":
      return <Badge variant="secondary">Checking</Badge>
    case "available":
    case "downloading":
    case "installing":
      return <Badge>Update available</Badge>
    case "up-to-date":
      return <Badge variant="secondary">Up to date</Badge>
    case "error":
      return <Badge variant="destructive">Check failed</Badge>
    default:
      return <Badge variant="secondary">Not checked</Badge>
  }
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function formatReleaseDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

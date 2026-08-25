import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Progress } from "@discloud/ui/components/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Switch } from "@discloud/ui/components/switch"
import { CheckCircle2Icon, DownloadIcon, Loader2Icon, RefreshCwIcon, RocketIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"

import type { UpdateChannel } from "../core/preferences"
import { useDesktopUpdater } from "./updater-provider"

const channels: { value: UpdateChannel; label: string; description: string }[] = [
  { value: "stable", label: "Stable", description: "Production releases only." },
  { value: "rc", label: "Release candidate", description: "RC builds and newer stable releases." },
  { value: "beta", label: "Beta", description: "Beta, RC and newer stable releases." },
  { value: "alpha", label: "Alpha", description: "Alpha, beta, RC and newer stable releases." },
]

export function DesktopUpdaterSettings() {
  const updater = useDesktopUpdater()
  const busy = updater.stage === "checking" || updater.stage === "preparing-runtime" || updater.stage === "downloading" || updater.stage === "installing"
  const progress = updater.totalBytes && updater.totalBytes > 0
    ? Math.min(100, updater.downloadedBytes / updater.totalBytes * 100)
    : undefined
  const selectedChannel = updater.preferences?.channel ?? "stable"
  const selectedChannelInfo = channels.find((channel) => channel.value === selectedChannel) ?? channels[0]
  const localRuntime = updater.update?.localRuntime
  const installBlocked = localRuntime?.compatible === false

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Updates</h2>
        <p className="text-sm text-muted-foreground">Choose an update channel, check signed releases and install them without leaving the app.</p>
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
              <CardDescription>Every channel uses signed manifests and the public signing key bundled into this application.</CardDescription>
            </div>
            <UpdateStatusBadge stage={updater.stage} channel={selectedChannel} />
          </div>
        </CardHeader>

        <CardContent>
          <SettingRow title="Installed version" description="The version currently running on this device.">
            <code className="rounded-md bg-muted px-2 py-1 text-sm">{updater.currentVersion ? `v${updater.currentVersion}` : "Loading..."}</code>
          </SettingRow>

          <SettingRow title="Update channel" description={selectedChannelInfo.description}>
            <Select value={selectedChannel} disabled={!updater.preferences || busy} onValueChange={(value) => void updater.setChannel(value as UpdateChannel)}>
              <SelectTrigger className="w-full sm:w-52" aria-label="Update channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {channels.map((channel) => <SelectItem key={channel.value} value={channel.value}>{channel.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow title="Check automatically" description={`Check the ${selectedChannelInfo.label} channel once when a packaged DisCloud app starts.`}>
            <Switch checked={updater.preferences?.checkOnStartup ?? true} disabled={!updater.preferences || busy} onCheckedChange={(enabled) => void updater.setCheckOnStartup(enabled)} />
          </SettingRow>

          <SettingRow title="Check now" description={updater.lastCheckedAt ? `Last checked ${formatDateTime(updater.lastCheckedAt)}.` : `No ${selectedChannelInfo.label} channel check has completed in this process yet.`} last>
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
          <AlertDescription>You are running the newest release currently available on the {selectedChannelInfo.label} channel.</AlertDescription>
        </Alert>
      ) : null}

      {updater.update ? (
        <Card>
          <CardHeader>
            <CardTitle>Version {updater.update.version}</CardTitle>
            <CardDescription>
              {selectedChannelInfo.label} channel · update from v{updater.update.currentVersion}
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

            {localRuntime ? localRuntime.compatible ? (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>Local runtime compatible</AlertTitle>
                <AlertDescription>Backend v{localRuntime.backendVersion} is available for this Desktop release. PostgreSQL remains pinned to v{localRuntime.postgresqlVersion}. Required runtime components will be staged and verified before Desktop installation starts.</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Local runtime is not compatible with this update</AlertTitle>
                <AlertDescription>{localRuntime.detail ?? `Backend v${localRuntime.backendVersion} is unavailable for this platform.`} Desktop installation is blocked while this device uses Local mode.</AlertDescription>
              </Alert>
            ) : null}

            {localRuntime?.webEnabled && localRuntime.webCompatible === false ? (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>Managed web runtime is unavailable for this update</AlertTitle>
                <AlertDescription>{localRuntime.webDetail ?? `Managed web v${localRuntime.webVersion ?? updater.update.version} is unavailable for this platform.`} The Desktop and managed backend can still update; the optional web UI will remain unavailable until a matching artifact is published.</AlertDescription>
              </Alert>
            ) : localRuntime?.webEnabled && localRuntime.webCompatible ? (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>Managed web runtime compatible</AlertTitle>
                <AlertDescription>Managed web v{localRuntime.webVersion ?? updater.update.version} is available and will be staged with its embedded Node.js runtime.</AlertDescription>
              </Alert>
            ) : null}

            {updater.stage === "preparing-runtime" || updater.stage === "downloading" || updater.stage === "installing" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{updater.stage === "preparing-runtime" ? "Preparing local runtime" : updater.stage === "installing" ? "Installing update" : "Downloading update"}</span>
                  {progress !== undefined ? <span className="tabular-nums text-muted-foreground">{Math.round(progress)}%</span> : null}
                </div>
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  {updater.stage === "preparing-runtime"
                    ? `Downloading and verifying managed runtime components for v${localRuntime?.backendVersion ?? updater.update.version} before Desktop is changed.`
                    : updater.stage === "installing"
                    ? "DisCloud will relaunch when installation finishes."
                    : updater.totalBytes
                      ? `${formatBytes(updater.downloadedBytes)} / ${formatBytes(updater.totalBytes)}`
                      : `${formatBytes(updater.downloadedBytes)} downloaded`}
                </p>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={busy || installBlocked} onClick={() => void updater.installUpdate()}>
                {busy ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                {updater.stage === "preparing-runtime"
                  ? "Preparing runtime..."
                  : updater.stage === "downloading"
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
          <AlertDescription>Automatic checks are disabled in development. Use a signed packaged build when validating channel switching, installation and relaunch.</AlertDescription>
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

function UpdateStatusBadge({ stage, channel }: { stage: ReturnType<typeof useDesktopUpdater>["stage"]; channel: UpdateChannel }) {
  if (stage === "checking") return <Badge variant="secondary">Checking {channel}</Badge>
  if (stage === "available" || stage === "preparing-runtime" || stage === "downloading" || stage === "installing") return <Badge>Update available</Badge>
  if (stage === "up-to-date") return <Badge variant="secondary">{channel} up to date</Badge>
  if (stage === "error") return <Badge variant="destructive">Check failed</Badge>
  return <Badge variant="secondary">{channel}</Badge>
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

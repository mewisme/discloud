import { Badge } from "@discloud/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { DatabaseIcon, FolderIcon, Globe2Icon, ServerIcon, ShieldCheckIcon } from "lucide-react"

import type { LocalRuntimeSnapshot, LocalServerSettings } from "#lib/local-runtime"

export function LocalServerOverview({ settings, runtime }: { settings: LocalServerSettings; runtime: LocalRuntimeSnapshot | null }) {
  const services = [
    {
      icon: ServerIcon,
      label: "Backend",
      status: runtime?.backend?.running ? "Running" : "Stopped",
      healthy: !!runtime?.backend?.running,
      endpoint: `127.0.0.1:${runtime?.backend?.port ?? settings.backendPreferredPort}`,
      version: versionDetail(runtime?.backend?.version, runtime?.backend?.desiredVersion),
    },
    {
      icon: DatabaseIcon,
      label: "PostgreSQL",
      status: runtime?.postgresql?.running ? "Running" : "Stopped",
      healthy: !!runtime?.postgresql?.running,
      endpoint: `127.0.0.1:${runtime?.postgresql?.port ?? settings.postgresqlPreferredPort}`,
      version: runtime?.postgresql?.version ? `v${runtime.postgresql.version}` : "Managed runtime",
    },
    {
      icon: Globe2Icon,
      label: "Managed web",
      status: !settings.webEnabled ? "Disabled" : runtime?.web?.running ? "Running" : runtime?.web?.error ? "Unavailable" : "Stopped",
      healthy: !settings.webEnabled || !!runtime?.web?.running,
      endpoint: `127.0.0.1:${runtime?.web?.port ?? settings.webPreferredPort}`,
      version: versionDetail(runtime?.web?.version, runtime?.web?.desiredVersion),
    },
  ]
  const requiredRunning = !!runtime?.backend?.running && !!runtime?.postgresql?.running
  const webReady = !settings.webEnabled || !!runtime?.web?.running
  const ready = requiredRunning && webReady

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Local server</CardTitle>
            <CardDescription>Health and connectivity for the services managed by this Desktop installation.</CardDescription>
          </div>
          <Badge variant={ready ? "default" : "secondary"}>{ready ? "Ready" : "Not running"}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-3">
          {services.map((service) => <ServiceCard key={service.label} {...service} />)}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FolderIcon className="size-4" />Local data</CardTitle>
            <CardDescription>Persistent PostgreSQL data and runtime state for this server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Data directory</p><p className="mt-1 break-all font-mono text-xs">{settings.dataDirectory}</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Data schema" value={`${settings.dataCompatibility.schemaVersion}`} />
              <Info label="Last used by" value={settings.dataCompatibility.lastAppVersion ? `DisCloud v${settings.dataCompatibility.lastAppVersion}` : "Legacy data"} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheckIcon className="size-4" />Data health</CardTitle>
            <CardDescription>Compatibility and recovery state before the managed services use this data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">Compatibility</p><p className="mt-0.5 text-xs text-muted-foreground">Supported schema {settings.dataCompatibility.supportedSchemaMin}-{settings.dataCompatibility.supportedSchemaMax}</p></div><Badge variant={settings.dataCompatibility.compatible ? "default" : "destructive"}>{settings.dataCompatibility.compatible ? "Compatible" : "Blocked"}</Badge></div>
            {runtime?.backend?.previousVersion ? <div className="rounded-lg border p-3"><p className="text-sm font-medium">Backend recovery artifact</p><p className="mt-1 text-xs text-muted-foreground">Backend v{runtime.backend.previousVersion} is retained locally. Automatic binary downgrade is intentionally disabled after database migrations.</p></div> : <div className="rounded-lg border p-3"><p className="text-sm font-medium">Backend recovery artifact</p><p className="mt-1 text-xs text-muted-foreground">No previous backend binary is currently retained.</p></div>}
            {runtime?.web?.error ? <p className="text-sm text-destructive">Managed web: {runtime.web.error}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ServiceCard({ icon: Icon, label, status, healthy, endpoint, version }: { icon: typeof ServerIcon; label: string; status: string; healthy: boolean; endpoint: string; version: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3"><div className="flex size-9 items-center justify-center rounded-lg bg-muted"><Icon className="size-4" /></div><Badge variant={healthy ? "default" : "secondary"}>{status}</Badge></div>
      <p className="mt-4 font-medium">{label}</p>
      <div className="mt-3 space-y-2 text-xs"><Detail label="Version" value={version} /><Detail label="Endpoint" value={endpoint} mono /></div>
    </div>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className={mono ? "font-mono" : "font-medium"}>{value}</span></div>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>
}

function versionDetail(current?: string | null, desired?: string | null) {
  if (current && desired && current !== desired) return `v${current} → v${desired}`
  if (current) return `v${current}`
  if (desired) return `Target v${desired}`
  return "Unavailable"
}
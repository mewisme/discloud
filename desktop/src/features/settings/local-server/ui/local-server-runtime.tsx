import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { LoaderCircle, RefreshCwIcon } from "lucide-react"

import type { LocalRuntimeSnapshot, LocalServerSettings } from "#lib/local-runtime"
import type { ConnectionMode } from "#lib/settings"

export function LocalServerRuntime({ settings, runtime, mode, restarting, configured, onRestart }: { settings: LocalServerSettings; runtime: LocalRuntimeSnapshot | null; mode: ConnectionMode | null; restarting: boolean; configured: boolean; onRestart: () => void }) {
  const compatible = settings.dataCompatibility.compatible
  return (
    <Card>
      <CardHeader>
        <CardTitle>Runtime</CardTitle>
        <CardDescription>Inspect managed runtime versions and restart the active Local server.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <RuntimeDetail label="Backend" value={runtime?.backend?.version ? `v${runtime.backend.version}` : runtime?.backend?.desiredVersion ? `target v${runtime.backend.desiredVersion}` : "Not prepared"} />
          <RuntimeDetail label="PostgreSQL" value={runtime?.postgresql?.version ? `v${runtime.postgresql.version}` : "Not prepared"} />
          <RuntimeDetail label="Managed web" value={!settings.webEnabled ? "Disabled" : runtime?.web?.version ? `v${runtime.web.version}` : runtime?.web?.desiredVersion ? `target v${runtime.web.desiredVersion}` : "Not prepared"} />
          <RuntimeDetail label="Runtime state" value={runtime?.status ?? "Not prepared"} />
        </div>
        <div className="rounded-lg border p-3 text-sm text-muted-foreground">Preferred ports: backend {settings.backendPreferredPort}, PostgreSQL {settings.postgresqlPreferredPort}, web {settings.webPreferredPort}. Persisted ports are reused when available; conflicts fall back inside 27834–27999.</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={!compatible || restarting || mode !== "local" || !configured} onClick={onRestart}>{restarting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCwIcon data-icon="inline-start" />}Restart local server</Button>
          {mode !== "local" ? <span className="text-sm text-muted-foreground">Switch the active connection to Local before restarting.</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function RuntimeDetail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { DatabaseIcon, Globe2Icon, ServerIcon } from "lucide-react"

import type { LocalRuntimeSnapshot, LocalServerSettings } from "#lib/local-runtime"

export function LocalServerOverview({ settings, runtime }: { settings: LocalServerSettings; runtime: LocalRuntimeSnapshot | null }) {
  const backendPort = runtime?.backend?.port ?? settings.backendPreferredPort
  const postgresqlPort = runtime?.postgresql?.port ?? settings.postgresqlPreferredPort
  const webPort = runtime?.web?.port ?? settings.webPreferredPort
  const backendVersion = runtime?.backend?.version
  const backendDesiredVersion = runtime?.backend?.desiredVersion
  const backendVersionDetail = backendVersion && backendDesiredVersion && backendVersion !== backendDesiredVersion ? `v${backendVersion} · target v${backendDesiredVersion}` : backendVersion ? `v${backendVersion}` : backendDesiredVersion ? `target v${backendDesiredVersion}` : "version unavailable"
  const webVersion = runtime?.web?.version
  const webDesiredVersion = runtime?.web?.desiredVersion
  const webVersionDetail = webVersion && webDesiredVersion && webVersion !== webDesiredVersion ? `v${webVersion} · target v${webDesiredVersion}` : webVersion ? `v${webVersion}` : webDesiredVersion ? `target v${webDesiredVersion}` : "version unavailable"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
        <CardDescription>Current state of the managed services owned by this Desktop installation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <RuntimeItem icon={ServerIcon} label="Backend" status={runtime?.backend?.running ? "Running" : "Stopped"} detail={`${backendVersionDetail} · 127.0.0.1:${backendPort}`} />
          <RuntimeItem icon={DatabaseIcon} label="PostgreSQL" status={runtime?.postgresql?.running ? "Running" : "Stopped"} detail={`127.0.0.1:${postgresqlPort}`} />
          <RuntimeItem icon={Globe2Icon} label="Managed web" status={!settings.webEnabled ? "Disabled" : runtime?.web?.running ? "Running" : runtime?.web?.error ? "Unavailable" : "Stopped"} detail={`${webVersionDetail} · 127.0.0.1:${webPort}`} />
        </div>
        {runtime?.backend?.previousVersion ? <p className="text-xs text-muted-foreground">Previous backend binary v{runtime.backend.previousVersion} is retained as a recovery artifact. Automatic binary downgrade is not performed after database migrations.</p> : null}
        {runtime?.web?.error ? <p className="text-sm text-destructive">Managed web: {runtime.web.error}</p> : null}
        <div className="rounded-lg border p-3 text-sm text-muted-foreground">Data directory: <span className="break-all font-mono text-xs">{settings.dataDirectory}</span></div>
      </CardContent>
    </Card>
  )
}

type RuntimeItemProps = { icon: typeof ServerIcon; label: string; status: string; detail: string }

function RuntimeItem({ icon: Icon, label, status, detail }: RuntimeItemProps) {
  return <div className="flex items-center gap-3 rounded-lg border p-3"><Icon className="size-4 text-muted-foreground" /><div className="min-w-0"><div className="font-medium">{label}</div><div className="text-sm text-muted-foreground">{status} · {detail}</div></div></div>
}

import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@discloud/ui/components/collapsible"
import { CopyButton } from "@discloud/ui/components/copy-button"
import { Progress } from "@discloud/ui/components/progress"
import { toast } from "@discloud/ui/components/sonner"
import { CheckCircle2Icon, ChevronDownIcon, CircleIcon, LoaderCircleIcon, MinusCircleIcon, TriangleAlertIcon } from "lucide-react"
import { type ComponentType, useEffect, useRef, useState } from "react"

import { getLocalRuntimeLog, type LocalRuntimeLogStage, type LocalRuntimeSnapshot, type LocalServerSettings } from "#lib/local-runtime"

export type LocalProvisioningStage = LocalRuntimeLogStage

type ProvisioningStepState = "pending" | "active" | "complete" | "skipped" | "warning" | "failed"

type LocalServerProvisioningProps = {
  settings: LocalServerSettings
  snapshot: LocalRuntimeSnapshot | null
  reachedStage: LocalProvisioningStage
  busy: boolean
  error?: string
  onRetry: () => void
  onBack: () => void
}

const STAGES: LocalProvisioningStage[] = ["prepare", "postgresqlRuntime", "database", "backend", "web", "connect"]
const PROVISIONING_ERROR_TOAST_ID = "local-provisioning-error"

export function getLocalProvisioningStage(snapshot: LocalRuntimeSnapshot | null, webEnabled: boolean): LocalProvisioningStage {
  if (!snapshot) return "prepare"
  switch (snapshot.status) {
    case "preparing": return "prepare"
    case "installing":
    case "downloading":
      if (!snapshot.postgresql?.installed && !snapshot.postgresql?.initialized && !snapshot.postgresql?.running) return "postgresqlRuntime"
      if (snapshot.postgresql?.running && !snapshot.backend?.desiredInstalled) return "backend"
      if (webEnabled && snapshot.backend?.running && !snapshot.web?.desiredInstalled) return "web"
      return inferIncompleteStage(snapshot, webEnabled)
    case "initializingDatabase":
    case "startingDatabase":
    case "databaseReady": return "database"
    case "startingBackend": return "backend"
    case "startingWeb": return "web"
    case "ready":
    case "degraded": return "connect"
    case "failed": return inferIncompleteStage(snapshot, webEnabled)
    default: return "prepare"
  }
}

export function advanceLocalProvisioningStage(current: LocalProvisioningStage, next: LocalProvisioningStage) {
  return STAGES.indexOf(next) > STAGES.indexOf(current) ? next : current
}

export function LocalServerProvisioning({ settings, snapshot, reachedStage, busy, error, onRetry, onBack }: LocalServerProvisioningProps) {
  const steps = buildSteps(settings, snapshot, reachedStage, error)
  const completed = 1 + STAGES.indexOf(reachedStage)
  const progress = Math.round((completed / steps.length) * 100)

  useEffect(() => {
    if (!error) {
      toast.dismiss(PROVISIONING_ERROR_TOAST_ID)
      return
    }
    toast.error("Local provisioning failed", {
      id: PROVISIONING_ERROR_TOAST_ID,
      description: (
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <CopyButton value={error} label="Copy error" copiedLabel="Error copied" type="button" size="icon-xs" variant="ghost" />
        </div>
      ),
    })
    return () => {
      toast.dismiss(PROVISIONING_ERROR_TOAST_ID)
    }
  }, [error])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Setting up DisCloud Local</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
            <span>{completed} of {steps.length} steps complete</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>

        <div className="space-y-1">
          {steps.map((step) => <ProvisioningStep key={step.label} {...step} />)}
        </div>
      </CardContent>
      {error ? (
        <CardFooter className="flex justify-between gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onBack}>Back to setup</Button>
          <Button type="button" disabled={busy} onClick={onRetry}>{busy ? <><LoaderCircleIcon data-icon="inline-start" className="animate-spin" />Retrying</> : "Retry"}</Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

type ProvisioningStepProps = {
  label: string
  description: string
  state: ProvisioningStepState
  logStage?: LocalRuntimeLogStage
}

function ProvisioningStep({ label, description, state, logStage }: ProvisioningStepProps) {
  const Icon = stepIcon(state)
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState("")
  const [logError, setLogError] = useState<string>()
  const [truncated, setTruncated] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !logStage) return
    let cancelled = false
    const load = async () => {
      try {
        const next = await getLocalRuntimeLog(logStage)
        if (cancelled) return
        setLog(next.content)
        setTruncated(next.truncated)
        setLogError(undefined)
      } catch (error) {
        if (cancelled) return
        setLogError(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), 500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [open, logStage])

  useEffect(() => {
    if (!open || !logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, open])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg px-2 py-2.5">
      <div className="flex gap-3">
        <Icon className={`mt-0.5 size-4 shrink-0 ${state === "active" ? "animate-spin" : ""}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className={`text-xs ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{description}</p>
            </div>
            {logStage ? (
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs">
                  {open ? "Hide logs" : "View logs"}
                  <ChevronDownIcon className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
            ) : null}
          </div>
          {logStage ? (
            <CollapsibleContent>
              <div className="mt-2 overflow-hidden rounded-md border bg-muted/30" aria-live="off">
                <div className="flex h-8 items-center justify-between border-b px-3 text-[11px] text-muted-foreground">
                  <span>{truncated ? "Live log - showing latest 64 KiB" : "Live log"}</span>
                  {log ? <CopyButton value={log} label="Copy log" copiedLabel="Log copied" type="button" size="icon-xs" variant="ghost" /> : null}
                </div>
                <div ref={logRef} className="max-h-48 overflow-auto p-3">
                  <pre className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-4 ${logError ? "text-destructive" : "text-muted-foreground"}`}>
                    {logError ? `Could not load logs: ${logError}` : log || "Waiting for log output..."}
                  </pre>
                </div>
              </div>
            </CollapsibleContent>
          ) : null}
        </div>
      </div>
    </Collapsible>
  )
}

function buildSteps(settings: LocalServerSettings, snapshot: LocalRuntimeSnapshot | null, reachedStage: LocalProvisioningStage, error?: string): ProvisioningStepProps[] {
  const stageIndex = STAGES.indexOf(reachedStage)
  const stateFor = (stage: LocalProvisioningStage): ProvisioningStepState => {
    const index = STAGES.indexOf(stage)
    if (index < stageIndex) return "complete"
    if (index > stageIndex) return "pending"
    if (error) return "failed"
    return "active"
  }
  const postgresVersion = snapshot?.manifest?.components.postgresql.version ?? "18.6.0"
  const backendVersion = snapshot?.backend?.desiredVersion ?? snapshot?.manifest?.components.backend.version
  const webVersion = snapshot?.web?.desiredVersion ?? snapshot?.manifest?.components.web?.version
  const webState: ProvisioningStepState = !settings.webEnabled ? "skipped" : snapshot?.web?.error ? "warning" : stateFor("web")

  return [
    { label: "Configuration", description: "Local settings and secrets are saved.", state: "complete" },
    { label: "Local data directory", description: stateDescription(stateFor("prepare"), `Preparing ${settings.dataDirectory}.`, "Runtime directories and configuration are ready."), state: stateFor("prepare"), logStage: "prepare" },
    { label: `PostgreSQL ${postgresVersion}`, description: postgresqlRuntimeDescription(snapshot, stateFor("postgresqlRuntime"), postgresVersion), state: stateFor("postgresqlRuntime"), logStage: "postgresqlRuntime" },
    { label: "PostgreSQL database", description: databaseDescription(snapshot, stateFor("database")), state: stateFor("database"), logStage: "database" },
    { label: backendVersion ? `DisCloud backend ${backendVersion}` : "DisCloud backend", description: backendDescription(snapshot, stateFor("backend"), backendVersion), state: stateFor("backend"), logStage: "backend" },
    { label: webVersion ? `Managed Web UI ${webVersion}` : "Managed Web UI", description: webDescription(settings, snapshot, webState, webVersion), state: webState, logStage: "web" },
    { label: "Desktop connection", description: stateDescription(stateFor("connect"), "Checking server setup status and connecting Desktop.", "Desktop is connected to the local server."), state: stateFor("connect"), logStage: "connect" },
  ]
}

function inferIncompleteStage(snapshot: LocalRuntimeSnapshot, webEnabled: boolean): LocalProvisioningStage {
  if (!snapshot.postgresql?.installed) return "postgresqlRuntime"
  if (!snapshot.postgresql.initialized || !snapshot.postgresql.running) return "database"
  if (!snapshot.backend?.running) return "backend"
  if (webEnabled && !snapshot.web?.running && !snapshot.web?.error) return "web"
  return "connect"
}

function postgresqlRuntimeDescription(snapshot: LocalRuntimeSnapshot | null, state: ProvisioningStepState, version: string) {
  if (state === "active" && snapshot?.status === "installing") return `Extracting bundled PostgreSQL ${version}.`
  if (state === "active" && snapshot?.status === "downloading") return `Downloading and verifying PostgreSQL ${version}.`
  return stateDescription(state, `Checking PostgreSQL ${version} runtime.`, `PostgreSQL ${version} runtime is ready.`)
}

function databaseDescription(snapshot: LocalRuntimeSnapshot | null, state: ProvisioningStepState) {
  if (state === "active") {
    if (snapshot?.status === "initializingDatabase") return "Initializing the PostgreSQL cluster."
    if (snapshot?.status === "startingDatabase") return "Starting PostgreSQL on the local loopback interface."
    if (snapshot?.status === "databaseReady") return "PostgreSQL is ready; preparing the backend."
    return "Preparing the PostgreSQL database."
  }
  const port = snapshot?.postgresql?.port
  return stateDescription(state, "Preparing the PostgreSQL database.", port ? `PostgreSQL is ready on 127.0.0.1:${port}.` : "PostgreSQL is ready.")
}

function backendDescription(snapshot: LocalRuntimeSnapshot | null, state: ProvisioningStepState, version?: string) {
  if (state === "active" && snapshot?.status === "installing") return `Installing bundled backend ${version ?? "runtime"}.`
  if (state === "active" && snapshot?.status === "downloading") return `Downloading and verifying backend ${version ?? "runtime"}.`
  if (state === "active" && snapshot?.status === "startingBackend") return "Starting the backend and waiting for /readyz."
  const port = snapshot?.backend?.port
  return stateDescription(state, "Preparing the managed backend.", port ? `Backend is ready on 127.0.0.1:${port}.` : "Backend is ready.")
}

function webDescription(settings: LocalServerSettings, snapshot: LocalRuntimeSnapshot | null, state: ProvisioningStepState, version?: string) {
  if (!settings.webEnabled) return "Skipped because Managed Web UI is disabled."
  if (state === "warning") return snapshot?.web?.error ?? "Managed Web UI is unavailable, but the core local server can continue."
  if (state === "active" && snapshot?.status === "installing") return `Extracting bundled Managed Web UI ${version ?? "runtime"}.`
  if (state === "active" && snapshot?.status === "downloading") return `Downloading and verifying Managed Web UI ${version ?? "runtime"}.`
  if (state === "active" && snapshot?.status === "startingWeb") return "Starting the embedded Node.js Web runtime and waiting for /healthz."
  return stateDescription(state, "Preparing the optional Managed Web UI.", snapshot?.web?.url ? `Managed Web UI is ready at ${snapshot.web.url}.` : "Managed Web UI is ready.")
}

function stateDescription(state: ProvisioningStepState, active: string, complete: string) {
  if (state === "complete" || state === "warning") return complete
  if (state === "failed") return "This step could not be completed."
  if (state === "skipped") return "Skipped."
  if (state === "active") return active
  return "Waiting for the previous step."
}

function stepIcon(state: ProvisioningStepState): ComponentType<{ className?: string }> {
  switch (state) {
    case "complete": return CheckCircle2Icon
    case "active": return LoaderCircleIcon
    case "skipped": return MinusCircleIcon
    case "warning":
    case "failed": return TriangleAlertIcon
    default: return CircleIcon
  }
}

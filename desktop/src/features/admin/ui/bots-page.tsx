import type { BotRuntimeBot, BotRuntimeSnapshot } from "@discloud/api/models"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { ActivityIcon, BanIcon, BotIcon, Loader2Icon, PlayIcon, PowerIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"

import { loadBotRuntime, runBotAction } from "../core/api"
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "../core/format"

const pollIntervalMs = 2500

type BotAction = "probe" | "drain" | "disable" | "enable"

export function DesktopAdminBotsPage() {
  const [snapshot, setSnapshot] = useState<BotRuntimeSnapshot>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      setSnapshot(await loadBotRuntime())
      setError(undefined)
    } catch (cause) {
      if (!silent) setError(errorMessage(cause))
    } finally {
      if (!silent) setRefreshing(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const poll = setInterval(() => void refresh(true), pollIntervalMs)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(clock)
    }
  }, [refresh])

  if (loading && !snapshot) return <LoadingState />

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2"><BotIcon className="size-6" /><h1 className="text-2xl font-semibold tracking-tight">Bots</h1><Badge variant="secondary">Polling</Badge></div>
          <p className="mt-1 text-sm text-muted-foreground">Discord storage bot pool, scheduler capacity, leases, queues, and runtime health.</p>
          <p className="mt-1 text-xs text-muted-foreground">Drain, disable, enable, and health state are runtime-only and reset when the DisCloud process restarts.</p>
        </div>
        <Button variant="outline" disabled={refreshing} onClick={() => void refresh()}><RefreshCwIcon className={refreshing ? "animate-spin" : ""} />Refresh</Button>
      </div>

      {error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Could not refresh bot runtime</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {snapshot ? <><BotSummary snapshot={snapshot} /><BotTable bots={snapshot.bots} now={now} onChanged={() => refresh()} /></> : null}
    </div>
  )
}

function BotSummary({ snapshot }: { snapshot: BotRuntimeSnapshot }) {
  const draining = snapshot.bots.filter((bot) => bot.resolved && bot.state === "draining").length
  const disabled = snapshot.bots.filter((bot) => bot.resolved && bot.state === "disabled").length
  const unhealthy = snapshot.bots.filter((bot) => bot.resolved && bot.state === "unhealthy").length
  const queues = Object.entries(snapshot.queues).filter(([, queue]) => queue.depth > 0)

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="grid divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <SummaryBlock title="Pool" primary={snapshot.summary.configured} primaryLabel="Configured" values={[["Resolved", snapshot.summary.resolved], ["Unresolved", snapshot.summary.unresolved]]} />
        <SummaryBlock title="Capacity" primary={snapshot.summary.availableNow} primaryLabel="Available now" values={[["Effective", snapshot.summary.effectiveCapacity], ["Working", snapshot.summary.working], ["Cooldown", snapshot.summary.cooldown]]} />
        <SummaryBlock title="Runtime" primary={unhealthy} primaryLabel="Unhealthy" values={[["Draining", draining], ["Disabled", disabled]]} />
      </div>
      <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-baseline gap-2"><span className="text-xs font-medium text-muted-foreground">Scheduler queue</span><span className="text-sm font-semibold tabular-nums">{formatNumber(snapshot.summary.totalWaiting)}</span><span className="text-xs text-muted-foreground">waiting</span></div><div className="flex flex-wrap gap-2">{queues.length ? queues.map(([operation, queue]) => <Badge key={operation} variant="outline" className="gap-1.5"><span className="capitalize">{operation}</span><span>{queue.depth}</span>{queue.oldestWaitMs > 0 ? <span className="text-muted-foreground">· {formatDuration(queue.oldestWaitMs)}</span> : null}</Badge>) : <Badge variant="outline">No waiting work</Badge>}</div></div>
    </section>
  )
}

function SummaryBlock({ title, primary, primaryLabel, values }: { title: string; primary: number; primaryLabel: string; values: readonly (readonly [string, number])[] }) {
  return <div className="p-4"><p className="text-xs font-medium text-muted-foreground">{title}</p><div className="mt-3 flex items-end justify-between gap-6"><div><p className="text-2xl font-semibold tabular-nums">{formatNumber(primary)}</p><p className="mt-0.5 text-xs text-muted-foreground">{primaryLabel}</p></div><dl className="grid min-w-32 gap-1.5 text-xs">{values.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-5"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{formatNumber(value)}</dd></div>)}</dl></div></div>
}

function BotTable({ bots, now, onChanged }: { bots: readonly BotRuntimeBot[]; now: number; onChanged: () => Promise<void> }) {
  return (
    <section className="space-y-3">
      <div><h2 className="text-lg font-semibold">Bots</h2><p className="text-sm text-muted-foreground">Configured identities, leases, cooldowns and process-local metrics.</p></div>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader><TableRow><TableHead>Bot</TableHead><TableHead>State</TableHead><TableHead>Current work</TableHead><TableHead className="hidden md:table-cell">Throughput</TableHead><TableHead className="hidden lg:table-cell">Failures</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {bots.length ? bots.map((bot) => <TableRow key={`config-${bot.configIndex}`}>
              <TableCell><div><p className="font-medium">{bot.displayName || bot.username || `Configured bot #${bot.configIndex + 1}`}</p><p className="text-xs text-muted-foreground">{bot.resolved ? `@${bot.username}` : `Config index ${bot.configIndex} · unresolved`}</p>{bot.resolved && bot.metrics.lastSuccessAt ? <p className="mt-1 text-[11px] text-muted-foreground">Last success {formatDateTime(bot.metrics.lastSuccessAt)}</p> : null}</div></TableCell>
              <TableCell><BotState bot={bot} now={now} /></TableCell>
              <TableCell><BotWork bot={bot} /></TableCell>
              <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">{bot.metrics.lastThroughputBytesPerSecond > 0 ? `${formatBytes(bot.metrics.lastThroughputBytesPerSecond)}/s` : "—"}</TableCell>
              <TableCell className="hidden tabular-nums text-muted-foreground lg:table-cell">{formatNumber(bot.metrics.operationsFailed)}</TableCell>
              <TableCell><BotActions bot={bot} onChanged={onChanged} /></TableCell>
            </TableRow>) : <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No configured Discord bots.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function BotState({ bot, now }: { bot: BotRuntimeBot; now: number }) {
  if (!bot.resolved) return <Badge variant="destructive">Unresolved</Badge>
  const variant = bot.state === "unhealthy" || bot.state === "cooldown" ? "destructive" : bot.state === "working" || bot.state === "draining" ? "secondary" : "outline"
  const remaining = bot.cooldownUntil ? Math.max(0, Date.parse(bot.cooldownUntil) - now) : 0
  return <div className="space-y-1"><Badge variant={variant} className="capitalize">{bot.state}</Badge>{remaining > 0 ? <p className="text-xs text-muted-foreground">{formatDuration(remaining)}</p> : null}</div>
}

function BotWork({ bot }: { bot: BotRuntimeBot }) {
  if (!bot.resolved) return <span className="text-sm text-destructive">Discord identity unavailable</span>
  if (!bot.lease) return <span className="text-sm text-muted-foreground">{bot.state === "disabled" ? "Disabled" : bot.state === "cooldown" ? "Cooling down" : "Waiting for work"}</span>
  const target = bot.lease.fileName || bot.lease.resourceId || bot.lease.uploadId
  return <div><div className="flex items-center gap-2"><Badge variant="outline" className="capitalize">{bot.lease.operation}</Badge>{target ? <span className="max-w-56 truncate text-sm">{target}</span> : null}</div><p className="mt-1 text-xs text-muted-foreground">{bot.lease.partIndex !== undefined ? `part ${bot.lease.partIndex + 1} · ` : ""}{bot.lease.sizeBytes > 0 ? formatBytes(bot.lease.sizeBytes) : ""}</p></div>
}

function BotActions({ bot, onChanged }: { bot: BotRuntimeBot; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState<BotAction>()
  const [error, setError] = useState<string>()

  async function run(action: BotAction) {
    if (pending) return
    setPending(action)
    setError(undefined)
    try {
      await runBotAction(actionPath(bot, action))
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(undefined)
    }
  }

  if (!bot.resolved) return <div className="space-y-1"><Button size="sm" variant="outline" disabled={!!pending} onClick={() => void run("probe")}>{pending ? <Loader2Icon className="animate-spin" /> : <ActivityIcon />}Probe & recover</Button>{error ? <p className="max-w-48 text-xs text-destructive">{error}</p> : null}</div>

  return <div className="space-y-1"><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={!!pending} onClick={() => void run("probe")}>{pending === "probe" ? <Loader2Icon className="animate-spin" /> : <ActivityIcon />}Probe</Button>{bot.state === "disabled" ? <Button size="sm" disabled={!!pending} onClick={() => void run("enable")}>{pending === "enable" ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}Enable</Button> : bot.state === "draining" ? <Button size="sm" variant="outline" disabled><Loader2Icon className="animate-spin" />Draining</Button> : bot.working ? <Button size="sm" variant="outline" disabled={!!pending} onClick={() => void run("drain")}>{pending === "drain" ? <Loader2Icon className="animate-spin" /> : <PowerIcon />}Drain</Button> : <Button size="sm" variant="outline" disabled={!!pending} onClick={() => void run("disable")}>{pending === "disable" ? <Loader2Icon className="animate-spin" /> : <BanIcon />}Disable</Button>}</div>{error ? <p className="max-w-56 text-xs text-destructive">{error}</p> : null}</div>
}

function actionPath(bot: BotRuntimeBot, action: BotAction) {
  if (!bot.resolved) return `/admin/bots/config/${bot.configIndex}/probe`
  if (!bot.id) throw new Error("Resolved Discord bot has no user ID.")
  return `/admin/bots/${encodeURIComponent(bot.id)}/${action}`
}

function LoadingState() {
  return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" />Loading bot runtime</div></div>
}

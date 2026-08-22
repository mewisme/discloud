import { Badge } from "@/components/ui/badge"
import type { BotRuntimeSnapshot } from "@/lib/api/models"
import { formatNumber } from "@/lib/helpers"

export function BotRuntimeSummary({
  snapshot,
}: {
  snapshot: BotRuntimeSnapshot
}) {
  const draining = countResolvedState(snapshot, "draining")
  const disabled = countResolvedState(snapshot, "disabled")
  const unhealthy = countResolvedState(snapshot, "unhealthy")
  const queues = Object.entries(snapshot.queues).filter(([, queue]) => queue.depth > 0)

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="grid divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Pool</p>

          <div className="mt-3 flex items-end justify-between gap-6">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(snapshot.summary.configured)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Configured</p>
            </div>

            <dl className="grid min-w-32 gap-1.5 text-xs">
              <SummaryRow label="Resolved" value={snapshot.summary.resolved} />
              <SummaryRow label="Unresolved" value={snapshot.summary.unresolved} />
            </dl>
          </div>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Capacity</p>

          <div className="mt-3 flex items-end justify-between gap-6">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(snapshot.summary.availableNow)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Available now</p>
            </div>

            <dl className="grid min-w-32 gap-1.5 text-xs">
              <SummaryRow label="Effective" value={snapshot.summary.effectiveCapacity} />
              <SummaryRow label="Working" value={snapshot.summary.working} />
              <SummaryRow label="Cooldown" value={snapshot.summary.cooldown} />
            </dl>
          </div>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Runtime</p>

          <div className="mt-3 flex items-end justify-between gap-6">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(unhealthy)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Unhealthy</p>
            </div>

            <dl className="grid min-w-32 gap-1.5 text-xs">
              <SummaryRow label="Draining" value={draining} />
              <SummaryRow label="Disabled" value={disabled} />
            </dl>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground">Scheduler queue</span>
          <span className="text-sm font-semibold tabular-nums">
            {formatNumber(snapshot.summary.totalWaiting)}
          </span>
          <span className="text-xs text-muted-foreground">waiting</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {queues.length === 0 ? (
            <Badge variant="outline">No waiting work</Badge>
          ) : queues.map(([operation, queue]) => (
            <Badge key={operation} variant="outline" className="gap-1.5">
              <span className="capitalize">{operation}</span>
              <span className="tabular-nums">{queue.depth}</span>
              {queue.oldestWaitMs > 0 && (
                <span className="text-muted-foreground">· {formatWait(queue.oldestWaitMs)}</span>
              )}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  )
}

function SummaryRow({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="flex items-center justify-between gap-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{formatNumber(value)}</dd>
    </div>
  )
}

function countResolvedState(
  snapshot: BotRuntimeSnapshot,
  state: BotRuntimeSnapshot["bots"][number]["state"],
) {
  return snapshot.bots.filter((bot) => bot.resolved && bot.state === state).length
}

function formatWait(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}
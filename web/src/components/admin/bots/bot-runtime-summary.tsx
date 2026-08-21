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

  const stats = [
    ["Configured", snapshot.summary.configured],
    ["Resolved", snapshot.summary.resolved],
    ["Unresolved", snapshot.summary.unresolved],
    ["Capacity", snapshot.summary.effectiveCapacity],
    ["Available", snapshot.summary.availableNow],
    ["Working", snapshot.summary.working],
    ["Cooldown", snapshot.summary.cooldown],
    ["Draining", draining],
    ["Disabled", disabled],
    ["Unhealthy", unhealthy],
    ["Waiting", snapshot.summary.totalWaiting],
  ] as const

  const queues = Object.entries(snapshot.queues).filter(([, queue]) => queue.depth > 0)

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(value)}</p>
          </div>
        ))}
      </div>

      <div className="flex min-h-6 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Scheduler queues</span>

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
    </section>
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

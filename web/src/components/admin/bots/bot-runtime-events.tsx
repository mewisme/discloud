import { Badge } from "@/components/ui/badge"
import type { BotRuntimeBot, BotRuntimeEvent } from "@/lib/api/models"
import { formatDateTime } from "@/lib/helpers"

export function BotRuntimeEvents({
  events,
  bots,
}: {
  events: readonly BotRuntimeEvent[]
  bots: readonly BotRuntimeBot[]
}) {
  const names = new Map<string, string>()

  for (const bot of bots) {
    if (!bot.id) continue
    names.set(bot.id, bot.displayName || bot.username || bot.id)
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Recent activity</h2>
        <p className="text-sm text-muted-foreground">
          In-memory runtime events only. This history resets when the process restarts.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border">
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No runtime activity yet.
          </div>
        ) : (
          <>
            <div className="hidden grid-cols-[6rem_minmax(0,1fr)_10rem] gap-4 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
              <span>Event</span>
              <span>Activity</span>
              <span className="text-right">Time</span>
            </div>

            <div className="divide-y">
              {events.map((event) => {
                const description = eventDescription(event)

                return (
                  <div
                    key={event.id}
                    className="grid gap-2 px-4 py-3 md:grid-cols-[6rem_minmax(0,1fr)_10rem] md:items-start md:gap-4"
                  >
                    <Badge variant="outline" className="w-24 justify-center">
                      {eventLabel(event.type)}
                    </Badge>

                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {eventTitle(event, names)}
                      </p>

                      {description && (
                        <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">
                          {description}
                        </p>
                      )}
                    </div>

                    <time className="whitespace-nowrap text-xs tabular-nums text-muted-foreground md:text-right">
                      {formatDateTime(event.at)}
                    </time>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function eventLabel(type: string) {
  switch (type) {
    case "bot.lease.started": return "Started"
    case "bot.lease.finished": return "Released"
    case "bot.cooldown.started": return "Cooldown"
    case "bot.cooldown.finished": return "Recovered"
    case "bot.state.changed": return "State"
    case "bot.identity.updated": return "Identity"
    case "scheduler.queue.changed": return "Queue"
    case "operation.succeeded": return "Success"
    case "operation.failed": return "Failed"
    default: return type
  }
}

function eventTitle(event: BotRuntimeEvent, names: Map<string, string>) {
  const bot = event.botId ? names.get(event.botId) ?? event.botId : ""
  const operation = event.operation && event.operation !== "unknown" ? event.operation : "operation"

  switch (event.type) {
    case "bot.lease.started": return `${bot || "Bot"} started ${operation}`
    case "bot.lease.finished": return `${bot || "Bot"} released ${operation}`
    case "bot.cooldown.started": return `${bot || "Bot"} entered cooldown`
    case "bot.cooldown.finished": return `${bot || "Bot"} returned to the pool`
    case "bot.state.changed": return `${bot || "Bot"} runtime state changed`
    case "bot.identity.updated": return `${bot || "Bot"} identity refreshed`
    case "scheduler.queue.changed": return `${capitalize(operation)} queue: ${event.queueDepth ?? 0} waiting`
    case "operation.succeeded": return `${bot || "Bot"} completed ${operation}`
    case "operation.failed": return `${bot || "Bot"} failed ${operation}`
    default: return event.type
  }
}

function eventDescription(event: BotRuntimeEvent) {
  return [
    event.fileName,
    event.partIndex !== undefined ? `part ${event.partIndex + 1}` : "",
    event.errorClass,
    event.message,
  ].filter(Boolean).join(" · ")
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}
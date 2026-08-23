"use client"

import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { BotIcon, RefreshCwIcon, WifiIcon, WifiOffIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { BotRuntimeEvents } from "@/components/admin/bots/bot-runtime-events"
import { BotRuntimeSummary } from "@/components/admin/bots/bot-runtime-summary"
import { BotRuntimeTable } from "@/components/admin/bots/bot-runtime-table"
import { useBotRuntime } from "@/components/admin/bots/use-bot-runtime"
import type { BotRuntimeSnapshot } from "@/lib/api/models"

export function AdminBotsView({
  initialSnapshot,
}: {
  initialSnapshot: BotRuntimeSnapshot
}) {
  const runtime = useBotRuntime(initialSnapshot)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(
      () => setNow(Date.now()),
      1000,
    )

    return () => clearInterval(timer)
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <BotIcon className="size-6" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Bots
            </h1>

            <Badge
              variant={
                runtime.connected
                  ? "secondary"
                  : "outline"
              }
              className="gap-1"
            >
              {runtime.connected
                ? <WifiIcon />
                : <WifiOffIcon />}

              {runtime.connected
                ? "Live"
                : "Reconnecting"}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            Realtime Discord storage bot pool, scheduler capacity, leases, queues, and runtime health.
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Drain, disable, enable, and health state are runtime-only and reset when the DisCloud process restarts.
          </p>
        </div>

        <Button
          variant="outline"
          disabled={runtime.refreshing}
          onClick={() => void runtime.refresh()}
        >
          <RefreshCwIcon
            className={
              runtime.refreshing
                ? "animate-spin"
                : ""
            }
          />
          Refresh
        </Button>
      </div>

      {runtime.error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {runtime.error}
        </div>
      )}

      <BotRuntimeSummary
        snapshot={runtime.snapshot}
      />

      <BotRuntimeTable
        bots={runtime.snapshot.bots}
        now={now}
        onChanged={runtime.refresh}
      />

      <BotRuntimeEvents
        events={runtime.events}
        bots={runtime.snapshot.bots}
      />
    </div>
  )
}
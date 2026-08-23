"use client"

import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { Fragment, useState } from "react"

import { BotRuntimeActions } from "@/components/admin/bots/bot-runtime-actions"
import { UserAvatar } from "@/components/common/user-avatar"
import type { BotRuntimeBot } from "@/lib/api/models"
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "@/lib/helpers"

export function BotRuntimeTable({
  bots,
  now,
  onChanged,
}: {
  bots: readonly BotRuntimeBot[]
  now: number
  onChanged: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState<string[]>([])

  function toggle(key: string) {
    setExpanded((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key])
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Bots</h2>
        <p className="text-sm text-muted-foreground">
          Configured Discord identities, resolution state, leases, cooldowns, runtime state, and process-local metrics.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bot</TableHead>
              <TableHead className="w-28">State</TableHead>
              <TableHead>Current work</TableHead>
              <TableHead className="hidden w-28 md:table-cell">Duration</TableHead>
              <TableHead className="hidden w-32 lg:table-cell">Throughput</TableHead>
              <TableHead className="hidden w-24 xl:table-cell">Failures</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {bots.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No configured Discord bots.
                </TableCell>
              </TableRow>
            )}

            {bots.map((bot) => {
              const key = botKey(bot)
              const open = expanded.includes(key)
              const name = botDisplayName(bot)
              const username = botUsername(bot)

              return (
                <Fragment key={key}>
                  <TableRow>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <UserAvatar
                          className="size-9 shrink-0"
                          name={name}
                          username={username}
                          src={bot.avatarUrl}
                        />

                        <div className="min-w-0">
                          <p className="truncate font-medium">{name}</p>
                          {bot.resolved ? (
                            <p className="truncate text-xs text-muted-foreground">@{username}</p>
                          ) : (
                            <p className="truncate text-xs text-muted-foreground">
                              Config index {bot.configIndex} · identity unresolved
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        <BotStateBadge bot={bot} />
                        {bot.cooldownUntil && (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {cooldownRemaining(bot.cooldownUntil, now)}
                          </p>
                        )}
                      </div>
                    </TableCell>

                    <TableCell><CurrentWork bot={bot} /></TableCell>

                    <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
                      {bot.lease ? formatDuration(currentLeaseDuration(bot.lease, now)) : "—"}
                    </TableCell>

                    <TableCell className="hidden tabular-nums text-muted-foreground lg:table-cell">
                      {bot.metrics.lastThroughputBytesPerSecond > 0
                        ? `${formatBytes(bot.metrics.lastThroughputBytesPerSecond)}/s`
                        : "—"}
                    </TableCell>

                    <TableCell className="hidden tabular-nums text-muted-foreground xl:table-cell">
                      {formatNumber(bot.metrics.operationsFailed)}
                    </TableCell>

                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={open ? "Hide bot details" : "Show bot details"}
                        aria-expanded={open}
                        onClick={() => toggle(key)}
                      >
                        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                      </Button>
                    </TableCell>
                  </TableRow>

                  {open && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/20 p-4">
                        <BotRuntimeDetails bot={bot} onChanged={onChanged} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function BotStateBadge({ bot }: { bot: BotRuntimeBot }) {
  if (!bot.resolved) return <Badge variant="destructive">Unresolved</Badge>

  switch (bot.state) {
    case "draining": return <Badge variant="secondary">Draining</Badge>
    case "disabled": return <Badge variant="outline">Disabled</Badge>
    case "unhealthy": return <Badge variant="destructive">Unhealthy</Badge>
    case "cooldown": return <Badge variant="destructive">Cooldown</Badge>
    case "working": return <Badge variant="secondary">Working</Badge>
    default: return <Badge variant="outline">Idle</Badge>
  }
}

function CurrentWork({ bot }: { bot: BotRuntimeBot }) {
  if (!bot.resolved) return <span className="text-destructive">Discord identity unavailable</span>

  const lease = bot.lease
  if (!lease) {
    switch (bot.state) {
      case "disabled": return <span className="text-muted-foreground">Disabled</span>
      case "unhealthy": return <span className="text-destructive">Unavailable</span>
      case "draining": return <span className="text-muted-foreground">Finishing current work</span>
      case "cooldown": return <span className="text-muted-foreground">Cooling down</span>
      default: return <span className="text-muted-foreground">Waiting for work</span>
    }
  }

  const target = lease.fileName || lease.resourceId || lease.uploadId
  const details = [
    lease.partIndex !== undefined ? `part ${lease.partIndex + 1}` : "",
    lease.sizeBytes > 0 ? formatBytes(lease.sizeBytes) : "",
  ].filter(Boolean).join(" · ")

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="capitalize">{lease.operation}</Badge>
        {target && <span className="max-w-64 truncate text-sm">{target}</span>}
      </div>
      {details && <p className="mt-1 text-xs text-muted-foreground">{details}</p>}
    </div>
  )
}

function BotRuntimeDetails({
  bot,
  onChanged,
}: {
  bot: BotRuntimeBot
  onChanged: () => Promise<void>
}) {
  const metrics = bot.metrics
  const values = [
    ["Config index", formatNumber(bot.configIndex)],
    ["Resolved", bot.resolved ? "Yes" : "No"],
    ["Discord user ID", bot.id || "—"],
    ["Runtime state", bot.resolved ? bot.state : "unresolved"],
    ["Successful operations", formatNumber(metrics.operationsSucceeded)],
    ["Failed operations", formatNumber(metrics.operationsFailed)],
    ["Rate limits", formatNumber(metrics.rateLimitedCount)],
    ["Bytes transferred", formatBytes(metrics.bytesTransferred)],
    ["Last operation", metrics.lastOperationDurationMs > 0 ? formatDuration(metrics.lastOperationDurationMs) : "—"],
    ["Last throughput", metrics.lastThroughputBytesPerSecond > 0 ? `${formatBytes(metrics.lastThroughputBytesPerSecond)}/s` : "—"],
    ["Last success", metrics.lastSuccessAt ? formatDateTime(metrics.lastSuccessAt) : "—"],
  ] as const

  return (
    <div className="space-y-4">
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {values.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 truncate text-sm tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {!bot.resolved && bot.resolveErrorMessage && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="destructive">{bot.resolveErrorClass || "resolution"}</Badge>
            <span className="text-muted-foreground">Startup identity resolution</span>
          </div>
          <p className="mt-2 break-words text-sm">{bot.resolveErrorMessage}</p>
        </div>
      )}

      {bot.resolved && metrics.lastErrorAt && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="destructive">{metrics.lastErrorClass || "error"}</Badge>
            <span className="text-muted-foreground">{formatDateTime(metrics.lastErrorAt)}</span>
          </div>
          {metrics.lastErrorMessage && <p className="mt-2 break-words text-sm">{metrics.lastErrorMessage}</p>}
        </div>
      )}

      <div className="border-t pt-4">
        <BotRuntimeActions bot={bot} onChanged={onChanged} />
      </div>
    </div>
  )
}

function botKey(bot: BotRuntimeBot) {
  return `config-${bot.configIndex}`
}

function botDisplayName(bot: BotRuntimeBot) {
  return bot.displayName || bot.username || `Configured bot #${bot.configIndex + 1}`
}

function botUsername(bot: BotRuntimeBot) {
  return bot.username || `config-${bot.configIndex}`
}

function currentLeaseDuration(lease: NonNullable<BotRuntimeBot["lease"]>, now: number) {
  const startedAt = Date.parse(lease.startedAt)
  if (!Number.isFinite(startedAt)) return lease.durationMs
  return Math.max(lease.durationMs, now - startedAt)
}

function cooldownRemaining(until: string, now: number) {
  const remaining = Date.parse(until) - now
  if (!Number.isFinite(remaining) || remaining <= 0) return "ending…"
  if (remaining < 1000) return "<1s"
  return `${Math.ceil(remaining / 1000)}s`
}

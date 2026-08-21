"use client"

import { ActivityIcon, BanIcon, Loader2Icon, PlayIcon, PowerIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { apiJSON } from "@/lib/api/client"
import type { BotRuntimeBot } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

type BotAction = "probe" | "drain" | "disable" | "enable"

export function BotRuntimeActions({
  bot,
  onChanged,
}: {
  bot: BotRuntimeBot
  onChanged: () => Promise<void>
}) {
  const [pending, setPending] = useState<BotAction | null>(null)

  async function run(action: BotAction) {
    if (pending) return
    setPending(action)

    try {
      await apiJSON<void>(actionPath(bot, action), { method: "POST" })
      toast.success(actionSuccess(action, botDisplayName(bot)))
      await onChanged()
    } catch (error) {
      toast.error(apiErrorMessage(error, `Could not ${action} ${botDisplayName(bot)}.`))
      await onChanged().catch(() => undefined)
    } finally {
      setPending(null)
    }
  }

  const disabled = pending !== null

  if (!bot.resolved) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void run("probe")}
        >
          {pending === "probe"
            ? <Loader2Icon className="animate-spin" />
            : <ActivityIcon />}
          Probe & recover
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => void run("probe")}
      >
        {pending === "probe"
          ? <Loader2Icon className="animate-spin" />
          : <ActivityIcon />}
        Probe
      </Button>

      {bot.state === "disabled" ? (
        <Button size="sm" disabled={disabled} onClick={() => void run("enable")}>
          {pending === "enable"
            ? <Loader2Icon className="animate-spin" />
            : <PlayIcon />}
          Enable
        </Button>
      ) : bot.state === "draining" ? (
        <Button size="sm" variant="outline" disabled>
          <Loader2Icon className="animate-spin" />
          Draining
        </Button>
      ) : bot.working ? (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void run("drain")}>
          {pending === "drain"
            ? <Loader2Icon className="animate-spin" />
            : <PowerIcon />}
          Drain
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void run("disable")}>
          {pending === "disable"
            ? <Loader2Icon className="animate-spin" />
            : <BanIcon />}
          Disable
        </Button>
      )}
    </div>
  )
}

function actionPath(bot: BotRuntimeBot, action: BotAction) {
  if (!bot.resolved) {
    if (action !== "probe") throw new Error("Unresolved Discord bots can only be probed.")
    return `/admin/bots/config/${bot.configIndex}/probe`
  }

  if (!bot.id) throw new Error("Resolved Discord bot has no user ID.")
  return `/admin/bots/${encodeURIComponent(bot.id)}/${action}`
}

function botDisplayName(bot: BotRuntimeBot) {
  return bot.displayName || bot.username || `configured bot #${bot.configIndex + 1}`
}

function actionSuccess(action: BotAction, name: string) {
  switch (action) {
    case "probe":
      return `${name} identity refreshed.`
    case "drain":
      return `${name} is draining.`
    case "disable":
      return `${name} disabled for this runtime.`
    case "enable":
      return `${name} enabled.`
  }
}

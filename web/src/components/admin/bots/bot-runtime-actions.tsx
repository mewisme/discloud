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
      await apiJSON<void>(
        `/admin/bots/${encodeURIComponent(bot.id)}/${action}`,
        { method: "POST" },
      )

      toast.success(actionSuccess(action, bot.displayName))
      await onChanged()
    } catch (error) {
      toast.error(
        apiErrorMessage(
          error,
          `Could not ${action} ${bot.displayName}.`,
        ),
      )
    } finally {
      setPending(null)
    }
  }

  const disabled = pending !== null

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
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => void run("enable")}
        >
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
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void run("drain")}
        >
          {pending === "drain"
            ? <Loader2Icon className="animate-spin" />
            : <PowerIcon />}
          Drain
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void run("disable")}
        >
          {pending === "disable"
            ? <Loader2Icon className="animate-spin" />
            : <BanIcon />}
          Disable
        </Button>
      )}
    </div>
  )
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
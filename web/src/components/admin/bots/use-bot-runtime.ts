"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { apiJSON, apiURL } from "@/lib/api/client"
import type { BotRuntimeEvent, BotRuntimeSnapshot } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"

const refreshDelayMs = 200
const maxRecentEvents = 100

const runtimeEventNames = [
  "bot.lease.started",
  "bot.lease.finished",
  "bot.cooldown.started",
  "bot.cooldown.finished",
  "bot.state.changed",
  "bot.identity.updated",
  "scheduler.queue.changed",
  "operation.succeeded",
  "operation.failed",
]

export function useBotRuntime(
  initialSnapshot: BotRuntimeSnapshot,
) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [events, setEvents] = useState<BotRuntimeEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const requestSequence = useRef(0)

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current
    setRefreshing(true)

    try {
      const next = await apiJSON<BotRuntimeSnapshot>(
        "/admin/bots",
      )

      if (sequence !== requestSequence.current) {
        return
      }

      setSnapshot(next)
      setError("")
    } catch (reason) {
      if (sequence !== requestSequence.current) {
        return
      }

      if (
        reason instanceof APIError &&
        reason.status === 401
      ) {
        router.replace("/login")
        router.refresh()
        return
      }

      setError(
        apiErrorMessage(
          reason,
          "Could not refresh bot runtime.",
        ),
      )
    } finally {
      if (sequence === requestSequence.current) {
        setRefreshing(false)
      }
    }
  }, [router])

  useEffect(() => {
    const source = new EventSource(
      apiURL("/admin/bots/events"),
      { withCredentials: true },
    )

    let refreshTimer:
      | ReturnType<typeof setTimeout>
      | undefined

    function scheduleRefresh(
      delay = refreshDelayMs,
    ) {
      if (refreshTimer !== undefined) {
        return
      }

      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        void refresh()
      }, delay)
    }

    function handleRuntimeEvent(event: Event) {
      const message = event as MessageEvent<string>
      let runtimeEvent: BotRuntimeEvent

      try {
        runtimeEvent = JSON.parse(
          message.data,
        ) as BotRuntimeEvent
      } catch {
        return
      }

      if (
        !Number.isFinite(runtimeEvent.id) ||
        !runtimeEvent.type ||
        !runtimeEvent.at
      ) {
        return
      }

      setEvents((current) => {
        if (
          current.some(
            (item) => item.id === runtimeEvent.id,
          )
        ) {
          return current
        }

        return [
          runtimeEvent,
          ...current,
        ].slice(0, maxRecentEvents)
      })

      scheduleRefresh()
    }

    function handleReset() {
      setEvents([])
      scheduleRefresh(0)
    }

    function handleReady() {
      setConnected(true)
    }

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)

    source.addEventListener(
      "ready",
      handleReady,
    )

    source.addEventListener(
      "reset",
      handleReset,
    )

    runtimeEventNames.forEach((name) => {
      source.addEventListener(
        name,
        handleRuntimeEvent,
      )
    })

    return () => {
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer)
      }

      source.close()
    }
  }, [refresh])

  return {
    snapshot,
    events,
    connected,
    refreshing,
    error,
    refresh,
  }
}
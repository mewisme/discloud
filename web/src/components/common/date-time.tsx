"use client"

import type { HTMLAttributes } from "react"
import { useUserConfig } from "@/components/settings/user-config-context"
import { formatDate, formatDateTime } from "@/lib/helpers"

type DateValue = string | number | Date

export function DateTime({ value, ...props }: { value: DateValue } & HTMLAttributes<HTMLTimeElement>) {
  const { timezone } = useUserConfig()
  const date = value instanceof Date ? value : new Date(value)

  return (
    <time dateTime={date.toISOString()} {...props}>
      {formatDateTime(date, timezone)}
    </time>
  )
}

export function DateOnly({ value, ...props }: { value: DateValue } & HTMLAttributes<HTMLTimeElement>) {
  const { timezone } = useUserConfig()
  const date = value instanceof Date ? value : new Date(value)

  return (
    <time dateTime={date.toISOString()} {...props}>
      {formatDate(date, timezone)}
    </time>
  )
}
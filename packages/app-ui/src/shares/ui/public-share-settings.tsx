"use client"

import type { Share, UpdateShareInput } from "@discloud/api/models"
import { Button } from "@discloud/ui/components/button"
import { Calendar } from "@discloud/ui/components/calendar"
import { Input } from "@discloud/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@discloud/ui/components/popover"
import { CalendarIcon, KeyRoundIcon, Loader2Icon, SaveIcon, ShieldXIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"

export function PublicShareSettings({
  share,
  pending,
  onSave,
  onRevokeSessions,
}: {
  share: Share
  pending: boolean
  onSave: (input: UpdateShareInput) => Promise<void>
  onRevokeSessions: () => Promise<void>
}) {
  const [expiresAt, setExpiresAt] = useState<Date>()
  const [password, setPassword] = useState("")
  const [clearPassword, setClearPassword] = useState(false)
  const [allowDownload, setAllowDownload] = useState(true)
  const [maxViews, setMaxViews] = useState("")
  const [maxDownloads, setMaxDownloads] = useState("")

  useEffect(() => {
    setExpiresAt(share.expiresAt ? new Date(share.expiresAt) : undefined)
    setPassword("")
    setClearPassword(false)
    setAllowDownload(share.allowDownload)
    setMaxViews(share.maxViews == null ? "" : String(share.maxViews))
    setMaxDownloads(share.maxDownloads == null ? "" : String(share.maxDownloads))
  }, [share])

  async function save() {
    const input: UpdateShareInput = {
      expiresAt: expiresAt?.toISOString() ?? null,
      allowDownload,
      maxViews: optionalPositiveInteger(maxViews),
      maxDownloads: optionalPositiveInteger(maxDownloads),
      ...(clearPassword ? { clearPassword: true } : password ? { password } : {}),
    }
    await onSave(input)
  }

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">Access controls</p>
        <p className="text-xs text-muted-foreground">Views: {share.viewCount}{share.maxViews == null ? "" : " / " + share.maxViews} · Downloads: {share.downloadCount}{share.maxDownloads == null ? "" : " / " + share.maxDownloads}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          Expires at
          <DateTimePicker value={expiresAt} disabled={pending} onChange={setExpiresAt} />
        </label>
        <label className="space-y-1 text-xs font-medium">
          New password
          <Input type="password" value={password} minLength={12} disabled={pending || clearPassword} placeholder={share.passwordProtected ? "Leave blank to keep current" : "Optional, 12+ characters"} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Max views
          <Input type="number" min={1} step={1} value={maxViews} disabled={pending} placeholder="Unlimited" onChange={(event) => setMaxViews(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Max downloads
          <Input type="number" min={1} step={1} value={maxDownloads} disabled={pending} placeholder="Unlimited" onChange={(event) => setMaxDownloads(event.target.value)} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allowDownload} disabled={pending} onChange={(event) => setAllowDownload(event.target.checked)} />
        Allow explicit downloads
      </label>

      {share.passwordProtected && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={clearPassword} disabled={pending} onChange={(event) => setClearPassword(event.target.checked)} />
          Remove password on save
        </label>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {share.passwordProtected && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void onRevokeSessions()}>
            <ShieldXIcon />
            Revoke sessions
          </Button>
        )}
        <Button type="button" disabled={pending} onClick={() => void save()}>
          {pending ? <Loader2Icon className="animate-spin" /> : password || clearPassword ? <KeyRoundIcon /> : <SaveIcon />}
          Save access
        </Button>
      </div>
    </div>
  )
}

function optionalPositiveInteger(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function DateTimePicker({ value, disabled, onChange }: { value?: Date; disabled: boolean; onChange: (value?: Date) => void }) {
  const minimum = minimumExpiration()
  const minimumDay = startOfDay(minimum)

  function selectDate(day?: Date) {
    if (!day) return
    const next = new Date(day)
    if (value) next.setHours(value.getHours(), value.getMinutes(), 0, 0)
    else next.setHours(23, 59, 0, 0)
    if (next < minimum) next.setTime(minimum.getTime())
    onChange(next)
  }

  function selectTime(time: string) {
    if (!value || !time) return
    const [hours, minutes] = time.split(":").map(Number)
    const next = new Date(value)
    next.setHours(hours, minutes, 0, 0)
    onChange(next < minimum ? minimum : next)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="w-full justify-start font-normal">
          <CalendarIcon className="text-muted-foreground" />
          <span className={value ? "" : "text-muted-foreground"}>{value ? formatDateTime(value) : "No expiration"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={value} disabled={{ before: minimumDay }} onSelect={selectDate} />
        <div className="flex items-center gap-2 border-t p-3">
          <Input type="time" value={value ? formatTime(value) : ""} min={value && sameDay(value, minimum) ? formatTime(minimum) : undefined} disabled={!value} className="w-32" onChange={(event) => selectTime(event.target.value)} />
          <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => onChange(undefined)}>
            <XIcon />
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function minimumExpiration() {
  const value = new Date(Date.now() + 60_000)
  value.setSeconds(0, 0)
  return value
}

function startOfDay(value: Date) {
  const result = new Date(value)
  result.setHours(0, 0, 0, 0)
  return result
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

function formatTime(value: Date) {
  return String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0")
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value)
}

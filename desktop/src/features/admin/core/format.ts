const gib = 1024 ** 3

export const temporaryPasswordMinLength = 6

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B"

  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  const amount = value / 1024 ** index

  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[index]}`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date)
}

export function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 ms"
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
  return `${(milliseconds / 60_000).toFixed(1)} min`
}

export function parseQuotaGiB(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Quota must be a non-negative number")

  const bytes = Math.round(amount * gib)
  if (!Number.isSafeInteger(bytes)) throw new Error("Quota is too large")
  return bytes
}

export function formatQuotaGiB(bytes: number | null) {
  if (bytes === null) return ""
  const value = bytes / gib
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "")
}

export function validateTemporaryPassword(password: string) {
  if (Array.from(password).length < temporaryPasswordMinLength) return `Temporary password must be at least ${temporaryPasswordMinLength} characters`
}

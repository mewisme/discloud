import { APIError } from "@/lib/api/types"

const bytesFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>()
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const interactiveSelector = "a,button,input,select,textarea,[role=button],[role=checkbox],[role=menuitem],[contenteditable=true]"

type NavigationMouseEvent = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  preventDefault: () => void
}

export type APIFormError = {
  message: string
  requestID?: string
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const exponent = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1)
  return `${bytes < 0 ? "-" : ""}${bytesFormatter.format(Math.abs(bytes) / 1024 ** exponent)} ${units[exponent]}`
}

export function formatDate(value: string | number | Date, timeZone = "UTC") {
  let formatter = dateFormatterCache.get(timeZone)

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone })
    dateFormatterCache.set(timeZone, formatter)
  }

  return formatter.format(toDate(value))
}

export function formatDateTime(value: string | number | Date, timeZone = "UTC") {
  let formatter = dateTimeFormatterCache.get(timeZone)

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone })
    dateTimeFormatterCache.set(timeZone, formatter)
  }

  return formatter.format(toDate(value))
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = seconds % 60

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`
}

export function formatNumber(value: number) {
  return numberFormatter.format(value)
}

export function initials(value: string, fallback = "DC") {
  return value.trim().slice(0, 2).toUpperCase() || fallback
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function handleClientNavigation(event: NavigationMouseEvent, navigate: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

  event.preventDefault()
  navigate()

  return true
}

export function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(interactiveSelector)
}

export function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof APIError ? error.message || fallback : fallback
}

export function apiFormError(error: unknown, fallback: string): APIFormError {
  if (!(error instanceof APIError)) return { message: fallback }

  return {
    message: error.message || fallback,
    ...(error.requestID ? { requestID: error.requestID } : {}),
  }
}

function toDate(value: string | number | Date) {
  return value instanceof Date ? value : new Date(value)
}
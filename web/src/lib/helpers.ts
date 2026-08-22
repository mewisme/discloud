export { apiErrorMessage, type APIFormError, apiFormError } from "@discloud/api/errors"
export { formatBytes, formatDate, formatDateTime, formatDuration, formatNumber, initials } from "@discloud/shared/format"

const interactiveSelector = "a,button,input,select,textarea,[role=button],[role=checkbox],[role=menuitem],[contenteditable=true]"

type NavigationMouseEvent = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  preventDefault: () => void
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
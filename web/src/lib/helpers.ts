export { apiErrorMessage, type APIFormError, apiFormError } from "@discloud/api/errors"
export { handleClientNavigation, isInteractiveTarget } from "@discloud/shared/dom"
export { formatBytes, formatDate, formatDateTime, formatDuration, formatNumber, initials } from "@discloud/shared/format"

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}
import { APIError } from "./types"

export type APIFormError = {
  message: string
  requestID?: string
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
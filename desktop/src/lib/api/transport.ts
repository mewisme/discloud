import type { APITransport, APITransportRequest } from "@discloud/api/transport"
import { APIError, type Problem, type Query } from "@discloud/api/types"
import { invoke } from "@tauri-apps/api/core"

type NativeAPIResponse = {
  status: number
  hasBody: boolean
  body: unknown
}

type NativeAPIError = {
  kind: string
  message: string
  status?: number
  statusText?: string
  problem?: Problem
}

export const desktopTransport: APITransport = {
  async request<T>(path: string, options: APITransportRequest = {}): Promise<T> {
    try {
      const response = await invoke<NativeAPIResponse>("api_request", {
        request: {
          method: options.method ?? "GET",
          path,
          query: queryEntries(options.query),
          headers: options.headers ? { ...options.headers } : {},
          body: options.body,
        },
      })

      if (!response.hasBody) return undefined as T

      return response.body as T
    } catch (error) {
      throw nativeError(error)
    }
  },
}

export function apiJSON<T>(path: string, options?: APITransportRequest) {
  return desktopTransport.request<T>(path, options)
}

export function nativeError(error: unknown): Error {
  if (error instanceof Error) return error

  if (isNativeAPIError(error)) {
    if (error.kind === "http" && error.status !== undefined) {
      return new APIError(
        error.status,
        error.statusText ?? "",
        error.problem,
      )
    }

    return new Error(error.message)
  }

  if (typeof error === "string") return new Error(error)

  return new Error("An unexpected native API error occurred.")
}

function queryEntries(query?: Query) {
  const entries: [string, string][] = []

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue

    const values = Array.isArray(value) ? value : [value]

    for (const item of values) {
      entries.push([key, String(item)])
    }
  }

  return entries
}

function isNativeAPIError(error: unknown): error is NativeAPIError {
  if (!error || typeof error !== "object") return false

  const value = error as Record<string, unknown>

  return typeof value.kind === "string" && typeof value.message === "string"
}
import type { Query } from "./types"

export type APIMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT"

export type APITransportRequest = {
  method?: APIMethod
  query?: Query
  headers?: Readonly<Record<string, string>>
  body?: unknown
}

export interface APITransport {
  request<T = unknown>(path: string, options?: APITransportRequest): Promise<T>
}
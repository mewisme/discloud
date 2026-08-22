export { APIError, type Problem, type Query, type QueryValue } from "@discloud/api/types"

export type APIRequestInit = RequestInit & {
  query?: import("@discloud/api/types").Query
  timeoutMs?: number
}

export type APIJSONInit = Omit<APIRequestInit, "body"> & {
  body?: unknown
}
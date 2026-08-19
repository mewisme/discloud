export type QueryValue = string | number | boolean
export type Query = Record<string, QueryValue | readonly QueryValue[] | null | undefined>

export interface Problem {
  type: string
  title: string
  status: number
  detail?: string
  request_id?: string
}

export type APIRequestInit = RequestInit & {
  query?: Query
  timeoutMs?: number
}

export type APIJSONInit = Omit<APIRequestInit, "body"> & {
  body?: unknown
}

export class APIError extends Error {
  readonly status: number
  readonly problem?: Problem
  readonly requestID?: string

  constructor(status: number, statusText: string, problem?: Problem) {
    super(problem?.detail || problem?.title || `${status} ${statusText}`)
    this.name = "APIError"
    this.status = status
    this.problem = problem
    this.requestID = problem?.request_id
  }
}
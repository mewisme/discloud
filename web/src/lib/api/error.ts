import { APIError, type Problem } from "@/lib/api/types"

export async function apiError(response: Response) {
  let problem: Problem | undefined
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim()

  if (contentType === "application/problem+json") {
    try {
      problem = await response.json() as Problem
    } catch {
      problem = undefined
    }
  }

  return new APIError(response.status, response.statusText, problem)
}
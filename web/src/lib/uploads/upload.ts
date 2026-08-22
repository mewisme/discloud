import "client-only"

import { apiJSON, apiRequest } from "@/lib/api/client"
import type { CompletedFile, CreateUploadInput, UploadSession } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { planUploadParts } from "@/lib/uploads/chunks"
import { AdaptiveConcurrencyGate, ConcurrencyGate } from "@/lib/uploads/gate"

export const uploadFileConcurrency = 3

const partGate = new AdaptiveConcurrencyGate()
const fileGate = new ConcurrencyGate(uploadFileConcurrency)

export type UploadCallbacks = {
  onSession: (sessionId: string) => void
  onProgress: (uploadedBytes: number) => void
  onFinalizing: () => void
  onCompleted?: (file: CompletedFile) => void
}

export function withUploadSlot<T>(work: () => Promise<T>) {
  return fileGate.run(work)
}

export async function uploadFile({
  file,
  folderId,
  sessionId,
  signal,
  callbacks,
}: {
  file: File
  folderId: string
  sessionId?: string
  signal: AbortSignal
  callbacks: UploadCallbacks
}) {
  const session = sessionId
    ? await apiJSON<UploadSession>(`/api/v1/uploads/${sessionId}`, { signal })
    : await createSession(file, folderId, signal)

  partGate.setCeiling(normalizePartConcurrency(session.recommendedPartConcurrency))
  callbacks.onSession(session.id)

  if (session.status === "completed") {
    callbacks.onProgress(file.size)
    return
  }
  if (session.status !== "open") {
    throw new Error(`Upload session is ${session.status}`)
  }
  if (session.parentFolderId !== folderId || session.size !== file.size) {
    throw new Error("Upload session no longer matches this file")
  }

  const plan = planUploadParts(file.size, session.chunkSize)
  if (plan.length !== session.expectedParts) {
    throw new Error("Upload session part count is inconsistent")
  }

  const uploadedParts = new Set(
    (session.parts ?? []).map((part) => part.partIndex),
  )
  let uploadedBytes = (session.parts ?? []).reduce(
    (total, part) => total + part.size,
    0,
  )
  callbacks.onProgress(uploadedBytes)

  const results = await Promise.allSettled(
    plan
      .filter((part) => !uploadedParts.has(part.index))
      .map((part) => partGate.run(async () => {
        throwIfAborted(signal)

        const blob = file.slice(part.start, part.end)
        const digest = await sha256Hex(blob)

        throwIfAborted(signal)

        await putPart(
          session.id,
          part.index,
          blob,
          digest,
          signal,
        )

        uploadedBytes += part.size
        callbacks.onProgress(uploadedBytes)
      }, signal)),
  )

  const failure = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected" && !isAbortError(result.reason),
  ) ?? results.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected",
  )

  if (failure) throw failure.reason

  callbacks.onFinalizing()

  const completedFile = await apiJSON<CompletedFile>(
    `/api/v1/uploads/${session.id}/complete`,
    {
      method: "POST",
      signal,
    },
  )

  callbacks.onProgress(file.size)
  callbacks.onCompleted?.(completedFile)
  return completedFile
}

async function createSession(
  file: File,
  folderId: string,
  signal: AbortSignal,
) {
  // ponytail: whole-file SHA stays optional to avoid buffering very large files in browser memory.
  const input: CreateUploadInput = {
    parentFolderId: folderId,
    name: file.name,
    size: file.size,
    ...(file.type ? { mimeTypeHint: file.type } : {}),
  }

  return apiJSON<UploadSession>("/api/v1/uploads", {
    method: "POST",
    body: input,
    signal,
  })
}

async function putPart(
  uploadId: string,
  index: number,
  body: Blob,
  sha256: string,
  signal: AbortSignal,
) {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "X-Chunk-SHA256": sha256,
  })

  for (let attempt = 0; ; attempt++) {
    const startedAt = performance.now()

    try {
      await apiRequest(
        `/api/v1/uploads/${uploadId}/parts/${index}`,
        {
          method: "PUT",
          headers,
          body,
          signal,
          timeoutMs: 0,
        },
      )

      partGate.recordSuccess(performance.now() - startedAt)
      return
    } catch (error) {
      const retryable = retryablePartError(error)
      if (retryable && !signal.aborted) partGate.recordCongestion()
      if (signal.aborted || attempt >= 2 || !retryable) throw error

      await delay(500 * 2 ** attempt, signal)
    }
  }
}

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  )

  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
}

function normalizePartConcurrency(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

function retryablePartError(error: unknown) {
  return error instanceof TypeError
    || error instanceof APIError
    && [408, 429, 502, 503, 504].includes(error.status)
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Upload cancelled", "AbortError")
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, ms)

    function abort() {
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Upload cancelled", "AbortError"),
      )
    }

    function done() {
      signal.removeEventListener("abort", abort)
      resolve()
    }

    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
}
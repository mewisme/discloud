import "client-only"

import { apiRequest } from "@/lib/api/client"
import { ConcurrencyGate } from "@/lib/uploads/gate"
import { canGenerateThumbnail, fitDimensions, videoSeekTime } from "@/lib/uploads/thumbnail-plan"

const generationGate = new ConcurrencyGate(2)
const captureTimeoutMs = 8000

export type PendingThumbnail = Promise<Blob | null>

// Starts local generation; call once per upload as soon as the task begins so
// decoding overlaps part uploads. The result settles before the PUT below.
export function generateUploadThumbnail(file: File): PendingThumbnail {
	if (!canGenerateThumbnail(file.type)) return Promise.resolve(null)
	return generationGate.run(() => captureThumbnail(file)).catch(() => {
		// ponytail: any decode/seek failure returns null; the server FFmpeg fallback stays in charge.
		return null
	})
}

// Uploads the generated thumbnail once the file is finalized. Never throws.
export async function settleUploadThumbnail(fileId: string, pending: PendingThumbnail | undefined, onUploaded?: () => void) {
	try {
		const blob = await pending
		if (!blob) return

		await apiRequest(`/api/v1/files/${fileId}/thumbnail`, {
			method: "PUT",
			headers: new Headers({ "Content-Type": blob.type || "application/octet-stream" }),
			body: blob,
			timeoutMs: 0,
		})
		onUploaded?.()
	} catch {
		// ponytail: upload failures are silent; server fallback covers the gap.
	}
}

async function captureThumbnail(file: File): Promise<Blob | null> {
	if (file.type.startsWith("image/")) return captureImageFrame(file)
	return captureVideoFrame(file)
}

async function captureImageFrame(file: File): Promise<Blob | null> {
	const bitmap = await createImageBitmap(file)
	try {
		const [width, height] = fitDimensions(bitmap.width, bitmap.height)
		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext("2d")
		if (!context) return null
		context.drawImage(bitmap, 0, 0, width, height)
		return await canvasToBlob(canvas)
	} finally {
		bitmap.close()
	}
}

async function captureVideoFrame(file: File): Promise<Blob | null> {
	const url = URL.createObjectURL(file)
	const video = document.createElement("video")
	video.muted = true
	video.playsInline = true
	video.preload = "auto"
	video.src = url

	try {
		await waitForMediaEvent(video, "loadedmetadata")
		video.currentTime = videoSeekTime(video.duration)
		await waitForMediaEvent(video, "seeked")

		const [width, height] = fitDimensions(video.videoWidth, video.videoHeight)
		if (!width || !height) return null

		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext("2d")
		if (!context) return null
		context.drawImage(video, 0, 0, width, height)
		return await canvasToBlob(canvas)
	} finally {
		video.removeAttribute("src")
		video.load()
		URL.revokeObjectURL(url)
	}
}

function waitForMediaEvent(video: HTMLVideoElement, event: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(onTimeout, captureTimeoutMs)

		function cleanup() {
			clearTimeout(timer)
			video.removeEventListener(event, onEvent)
			video.removeEventListener("error", onError)
		}
		function onEvent() {
			cleanup()
			resolve()
		}
		function onError() {
			cleanup()
			reject(new Error(`media failed before ${event}`))
		}
		function onTimeout() {
			cleanup()
			reject(new Error(`timed out waiting for ${event}`))
		}

		video.addEventListener(event, onEvent, { once: true })
		video.addEventListener("error", onError, { once: true })
	})
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
}

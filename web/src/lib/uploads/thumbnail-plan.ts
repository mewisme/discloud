export const thumbnailMaxDimension = 512

// P1.5b: seek to min(max(duration * 0.10, 1s), 10s).
export function videoSeekTime(durationSeconds: number): number {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1
	return Math.min(Math.max(durationSeconds * 0.10, 1), 10)
}

export function canGenerateThumbnail(mimeType?: string): boolean {
	if (!mimeType) return false
	return mimeType.startsWith("image/") || mimeType.startsWith("video/")
}

export function fitDimensions(width: number, height: number, max = thumbnailMaxDimension): [number, number] {
	if (width <= max && height <= max) return [width, height]
	const scale = max / Math.max(width, height)
	return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

import { describe, expect, it } from "vitest"

import { canGenerateThumbnail, fitDimensions, videoSeekTime } from "@/lib/uploads/thumbnail-plan"

describe("canGenerateThumbnail", () => {
	it("accepts image and video types", () => {
		expect(canGenerateThumbnail("image/png")).toBe(true)
		expect(canGenerateThumbnail("video/mp4")).toBe(true)
	})

	it("rejects non-media and missing types", () => {
		expect(canGenerateThumbnail("application/pdf")).toBe(false)
		expect(canGenerateThumbnail("")).toBe(false)
		expect(canGenerateThumbnail(undefined)).toBe(false)
	})
})

describe("videoSeekTime", () => {
	it("clamps to at least one second", () => {
		expect(videoSeekTime(5)).toBe(1)
		expect(videoSeekTime(0)).toBe(1)
	})

	it("uses ten percent of duration for medium videos", () => {
		expect(videoSeekTime(30)).toBeCloseTo(3)
		expect(videoSeekTime(60)).toBeCloseTo(6)
	})

	it("caps at ten seconds", () => {
		expect(videoSeekTime(300)).toBe(10)
		expect(videoSeekTime(3600)).toBe(10)
	})

	it("falls back to one second for unknown durations", () => {
		expect(videoSeekTime(Number.NaN)).toBe(1)
		expect(videoSeekTime(Number.POSITIVE_INFINITY)).toBe(1)
	})
})

describe("fitDimensions", () => {
	it("keeps small dimensions untouched", () => {
		expect(fitDimensions(400, 300)).toEqual([400, 300])
		expect(fitDimensions(512, 512)).toEqual([512, 512])
	})

	it("fits landscape within the max dimension", () => {
		expect(fitDimensions(1024, 512)).toEqual([512, 256])
	})

	it("fits portrait within the max dimension", () => {
		expect(fitDimensions(512, 2048)).toEqual([128, 512])
	})

	it("never returns zero-sized output", () => {
		expect(fitDimensions(4096, 2)).toEqual([512, 1])
	})
})

export type UploadPartPlan = {
  index: number
  start: number
  end: number
  size: number
}

export function planUploadParts(size: number, chunkSize: number): UploadPartPlan[] {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError("invalid file size")
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new RangeError("invalid chunk size")

  const count = Math.ceil(size / chunkSize)
  return Array.from({ length: count }, (_, index) => {
    const start = index * chunkSize
    const end = Math.min(size, start + chunkSize)
    return { index, start, end, size: end - start }
  })
}
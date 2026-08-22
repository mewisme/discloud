export type FilePreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "unsupported"

const inlineImages = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"])

export function filePreviewKind(mimeType: string, category?: string): FilePreviewKind {
  const mime = normalizeMIME(mimeType)
  if (inlineImages.has(mime)) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf") return "pdf"
  if (isTextMIME(mime) || category === "text") return "text"
  return "unsupported"
}

export function isTextMIME(mimeType: string) {
  const mime = normalizeMIME(mimeType)
  if (mime.startsWith("text/")) return true
  if (!mime.startsWith("application/")) return false
  return mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml")
}

function normalizeMIME(value: string) {
  return value.trim().toLowerCase().split(";", 1)[0]
}
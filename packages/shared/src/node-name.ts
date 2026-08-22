export function normalizedNodeName(value: string) {
  return value.trim()
}

export function nodeNameError(value: string) {
  const name = normalizedNodeName(value)

  if (!name) return "Name is required"
  if (name === "." || name === "..") return "Dot names are not allowed"
  if (/[/\\\u0000]/.test(name)) return "Path separators are not allowed"

  return undefined
}
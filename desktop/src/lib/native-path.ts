export function normalizeNativePath(value: string) {
  const verbatim = "\\\\?\\"
  if (!value.startsWith(verbatim)) return value
  const rest = value.slice(verbatim.length)
  if (rest.slice(0, 4).toLowerCase() === "unc\\") return `\\\\${rest.slice(4)}`
  return /^[a-z]:[\\/]/i.test(rest) ? rest : value
}

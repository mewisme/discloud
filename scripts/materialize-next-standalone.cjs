const fs = require("node:fs")
const path = require("node:path")

const [sourceArg, destinationArg] = process.argv.slice(2)
if (!sourceArg || !destinationArg) {
  console.error("Usage: node scripts/materialize-next-standalone.cjs <source> <destination>")
  process.exit(1)
}

const source = path.resolve(sourceArg)
const destination = path.resolve(destinationArg)

fs.rmSync(destination, { recursive: true, force: true })
fs.mkdirSync(destination, { recursive: true })
copyEntry(source, destination, new Set())
hydratePnpmAliases(source, destination)
assertNoLinks(destination)

function copyEntry(sourcePath, destinationPath, ancestors) {
  const stat = fs.lstatSync(sourcePath)
  if (stat.isSymbolicLink()) {
    const target = path.resolve(path.dirname(sourcePath), fs.readlinkSync(sourcePath))
    const normalizedTarget = normalizePath(target)
    if (ancestors.has(normalizedTarget)) throw new Error(`Symlink cycle detected: ${sourcePath} -> ${target}`)
    copyEntry(target, destinationPath, ancestors)
    return
  }
  if (stat.isDirectory()) {
    const normalizedSource = normalizePath(sourcePath)
    if (ancestors.has(normalizedSource)) throw new Error(`Directory cycle detected while materializing: ${sourcePath}`)
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(normalizedSource)
    fs.mkdirSync(destinationPath, { recursive: true })
    for (const entry of fs.readdirSync(sourcePath)) copyEntry(path.join(sourcePath, entry), path.join(destinationPath, entry), nextAncestors)
    return
  }
  if (!stat.isFile()) throw new Error(`Unsupported standalone entry: ${sourcePath}`)
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.copyFileSync(sourcePath, destinationPath)
  if (process.platform !== "win32") fs.chmodSync(destinationPath, stat.mode)
}

function hydratePnpmAliases(sourceRoot, destinationRoot) {
  const aliases = path.join(sourceRoot, "node_modules", ".pnpm", "node_modules")
  if (!fs.existsSync(aliases)) return
  hydrateAliasDirectory(aliases, path.join(destinationRoot, "node_modules"))
}

function hydrateAliasDirectory(sourceDirectory, destinationDirectory) {
  for (const entry of fs.readdirSync(sourceDirectory)) {
    const sourcePath = path.join(sourceDirectory, entry)
    const destinationPath = path.join(destinationDirectory, entry)
    const stat = fs.lstatSync(sourcePath)
    if (stat.isSymbolicLink()) {
      copyEntry(sourcePath, destinationPath, new Set())
      continue
    }
    if (stat.isDirectory() && entry.startsWith("@")) hydrateAliasDirectory(sourcePath, destinationPath)
  }
}

function assertNoLinks(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    const stat = fs.lstatSync(entryPath)
    if (stat.isSymbolicLink()) throw new Error(`Materialized standalone still contains a symlink: ${entryPath}`)
    if (stat.isDirectory()) assertNoLinks(entryPath)
  }
}

function normalizePath(value) {
  const normalized = path.resolve(value)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

process.noDeprecation = true

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const { tag, version, remote, dryRun } = parseArgs(process.argv.slice(2))

process.chdir(repoRoot)
preflight()

const plan = buildVersionPlan(version)
if (!plan.changes.length) fail(`All release version sources are already ${version}; refusing to create ${tag} without a version change.`)

printPlan(plan)
if (dryRun) {
  console.log("Dry run complete. No files, commits, tags, or remotes were changed.")
  process.exit(0)
}

applyPlan(plan)
run("git", ["diff", "--check"])
verifyAppliedVersions(plan, version)

run("git", ["add", "--", ...plan.changes.map((change) => change.relativePath)])
run("git", ["commit", "-m", `chore(release): prepare ${tag}`], { inherit: true })
run("git", ["tag", "-a", tag, "-m", tag])
run("git", ["push", "--atomic", remote, `HEAD:${plan.branch}`, `refs/tags/${tag}`], { inherit: true })

console.log(`Released ${tag} from ${shortHead()} and pushed ${plan.branch} + ${tag} to ${remote}.`)

function preflight() {
  const topLevel = path.resolve(run("git", ["rev-parse", "--show-toplevel"]).stdout.trim())
  if (topLevel.toLowerCase() !== repoRoot.toLowerCase()) fail(`Run this script from the DisCloud repository. Expected ${repoRoot}, got ${topLevel}.`)

  const status = run("git", ["status", "--porcelain"]).stdout.trim()
  if (status) fail("Working tree must be clean before creating a release tag.")

  const branchResult = spawn("git", ["symbolic-ref", "--quiet", "--short", "HEAD"])
  if (branchResult.status !== 0 || !branchResult.stdout.trim()) fail("Release tags cannot be created from a detached HEAD.")

  const remoteResult = spawn("git", ["remote", "get-url", remote])
  if (remoteResult.status !== 0) fail(`Git remote '${remote}' does not exist.`)

  run("git", ["fetch", "--prune", "--tags", remote], { inherit: true })
  if (spawn("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).status === 0) fail(`Tag ${tag} already exists locally.`)
  if (run("git", ["ls-remote", "--tags", remote, `refs/tags/${tag}`]).stdout.trim()) fail(`Tag ${tag} already exists on ${remote}.`)

  const branch = branchResult.stdout.trim()
  const remoteBranch = `refs/remotes/${remote}/${branch}`
  if (spawn("git", ["rev-parse", "--verify", "--quiet", remoteBranch]).status !== 0) fail(`Remote branch ${remote}/${branch} does not exist.`)
  const ancestor = spawn("git", ["merge-base", "--is-ancestor", remoteBranch, "HEAD"])
  if (ancestor.status !== 0) fail(`Local ${branch} does not contain the latest ${remote}/${branch}. Pull or rebase before releasing.`)
}

function buildVersionPlan(nextVersion) {
  const branch = run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]).stdout.trim()
  const changes = []
  const packageFiles = findFiles(repoRoot, "package.json")
  const cargoFiles = findFiles(repoRoot, "Cargo.toml")
  const tauriFiles = findFiles(repoRoot, "tauri.conf.json")
  const cargoPackages = new Set()

  for (const file of packageFiles) {
    const original = fs.readFileSync(file, "utf8")
    const json = parseJSON(original, file)
    if (typeof json.version !== "string") continue
    if (json.version === nextVersion) continue
    json.version = nextVersion
    changes.push(change(file, original, stringifyJSON(json, original)))
  }

  for (const file of cargoFiles) {
    const original = fs.readFileSync(file, "utf8")
    const result = updateCargoManifest(original, nextVersion, file)
    if (!result.packageName) continue
    cargoPackages.add(result.packageName)
    if (result.content !== original) changes.push(change(file, original, result.content))
  }

  for (const file of tauriFiles) {
    const original = fs.readFileSync(file, "utf8")
    const json = parseJSON(original, file)
    if (typeof json.version !== "string") fail(`${relative(file)} must contain a string version.`)
    if (json.version === nextVersion) continue
    json.version = nextVersion
    changes.push(change(file, original, stringifyJSON(json, original)))
  }

  const lockFiles = findFiles(repoRoot, "Cargo.lock")
  for (const file of lockFiles) {
    const original = fs.readFileSync(file, "utf8")
    const content = updateCargoLock(original, cargoPackages, nextVersion, file)
    if (content !== original) changes.push(change(file, original, content))
  }

  const changedPaths = new Set(changes.map((item) => item.path))
  const expected = [...packageFiles.filter(hasVersion), ...cargoFiles.filter(hasCargoPackage), ...tauriFiles]
  for (const file of expected) {
    if (!changedPaths.has(file) && currentVersion(file) !== nextVersion) fail(`Could not plan version update for ${relative(file)}.`)
  }

  return { branch, changes, packageFiles, cargoFiles, tauriFiles, cargoPackages }
}

function applyPlan(plan) {
  try {
    for (const item of plan.changes) fs.writeFileSync(item.path, item.content)
  } catch (error) {
    for (const item of plan.changes) {
      try { fs.writeFileSync(item.path, item.original) } catch {}
    }
    throw error
  }
}

function verifyAppliedVersions(plan, expectedVersion) {
  for (const file of plan.packageFiles) {
    const json = parseJSON(fs.readFileSync(file, "utf8"), file)
    if (typeof json.version === "string" && json.version !== expectedVersion) fail(`${relative(file)} has version ${json.version}, expected ${expectedVersion}.`)
  }
  for (const file of plan.tauriFiles) {
    const json = parseJSON(fs.readFileSync(file, "utf8"), file)
    if (json.version !== expectedVersion) fail(`${relative(file)} has version ${json.version ?? "<missing>"}, expected ${expectedVersion}.`)
  }
  for (const file of plan.cargoFiles) {
    const result = updateCargoManifest(fs.readFileSync(file, "utf8"), expectedVersion, file)
    if (result.packageName && result.currentVersion !== expectedVersion) fail(`${relative(file)} has Cargo version ${result.currentVersion}, expected ${expectedVersion}.`)
  }
  for (const file of findFiles(repoRoot, "Cargo.lock")) verifyCargoLock(fs.readFileSync(file, "utf8"), plan.cargoPackages, expectedVersion, file)
}

function updateCargoManifest(content, nextVersion, file) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n"
  const lines = content.split(/\r?\n/)
  let section = ""
  let packageName
  let currentVersion
  let versionLine = -1

  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = lines[index].match(/^\s*\[([^\]]+)]\s*$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      continue
    }
    if (section !== "package") continue
    const nameMatch = lines[index].match(/^\s*name\s*=\s*"([^"]+)"\s*$/)
    if (nameMatch) packageName = nameMatch[1]
    const versionMatch = lines[index].match(/^(\s*version\s*=\s*)"([^"]+)"(\s*)$/)
    if (versionMatch) {
      currentVersion = versionMatch[2]
      versionLine = index
      if (currentVersion !== nextVersion) lines[index] = `${versionMatch[1]}"${nextVersion}"${versionMatch[3]}`
    }
  }

  if (packageName && versionLine < 0) fail(`${relative(file)} has a [package] section but no explicit version.`)
  return { packageName, currentVersion, content: lines.join(eol) }
}

function updateCargoLock(content, packageNames, nextVersion, file) {
  if (!packageNames.size) return content
  const eol = content.includes("\r\n") ? "\r\n" : "\n"
  const lines = content.split(/\r?\n/)
  const found = new Set()
  let blockStart = -1

  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index].trim() !== "[[package]]") continue
    if (blockStart >= 0) updateLockBlock(lines, blockStart, index, packageNames, nextVersion, found)
    blockStart = index
  }
  if (blockStart >= 0) updateLockBlock(lines, blockStart, lines.length, packageNames, nextVersion, found)

  for (const name of packageNames) if (!found.has(name)) fail(`${relative(file)} does not contain local Cargo package ${name}.`)
  return lines.join(eol)
}

function updateLockBlock(lines, start, end, packageNames, nextVersion, found) {
  let name
  let versionLine = -1
  let local = true
  for (let index = start + 1; index < end; index += 1) {
    const nameMatch = lines[index].match(/^name = "([^"]+)"$/)
    if (nameMatch) name = nameMatch[1]
    if (/^source = /.test(lines[index])) local = false
    if (/^version = "[^"]+"$/.test(lines[index])) versionLine = index
  }
  if (!name || !packageNames.has(name) || !local) return
  if (versionLine < 0) fail(`Cargo.lock package ${name} has no version.`)
  lines[versionLine] = `version = "${nextVersion}"`
  found.add(name)
}

function verifyCargoLock(content, packageNames, expectedVersion, file) {
  if (!packageNames.size) return
  const lines = content.split(/\r?\n/)
  const found = new Set()
  let blockStart = -1
  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index].trim() !== "[[package]]") continue
    if (blockStart >= 0) verifyLockBlock(lines, blockStart, index, packageNames, expectedVersion, found, file)
    blockStart = index
  }
  if (blockStart >= 0) verifyLockBlock(lines, blockStart, lines.length, packageNames, expectedVersion, found, file)
  for (const name of packageNames) if (!found.has(name)) fail(`${relative(file)} does not contain local Cargo package ${name}.`)
}

function verifyLockBlock(lines, start, end, packageNames, expectedVersion, found, file) {
  let name
  let version
  let local = true
  for (let index = start + 1; index < end; index += 1) {
    name ??= lines[index].match(/^name = "([^"]+)"$/)?.[1]
    version ??= lines[index].match(/^version = "([^"]+)"$/)?.[1]
    if (/^source = /.test(lines[index])) local = false
  }
  if (!name || !packageNames.has(name) || !local) return
  if (version !== expectedVersion) fail(`${relative(file)} package ${name} has version ${version ?? "<missing>"}, expected ${expectedVersion}.`)
  found.add(name)
}

function findFiles(root, targetName) {
  const files = []
  const ignored = new Set([".git", ".next", ".turbo", "coverage", "dist", "node_modules", "target"])
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(path.join(directory, entry.name))
        continue
      }
      if (entry.isFile() && entry.name === targetName) files.push(path.join(directory, entry.name))
    }
  }
  visit(root)
  return files.sort()
}

function hasVersion(file) {
  const json = parseJSON(fs.readFileSync(file, "utf8"), file)
  return typeof json.version === "string"
}

function hasCargoPackage(file) {
  return updateCargoManifest(fs.readFileSync(file, "utf8"), currentVersion(file) ?? "0.0.0", file).packageName !== undefined
}

function currentVersion(file) {
  const content = fs.readFileSync(file, "utf8")
  if (file.endsWith(".json")) return parseJSON(content, file).version
  if (path.basename(file) === "Cargo.toml") return updateCargoManifest(content, "__read_only__", file).currentVersion
  return undefined
}

function stringifyJSON(value, original) {
  const eol = original.includes("\r\n") ? "\r\n" : "\n"
  const indent = original.match(/^([ \t]+)"/m)?.[1] ?? "  "
  const trailing = /\r?\n$/.test(original)
  const json = JSON.stringify(value, null, indent).replaceAll("\n", eol)
  return trailing ? `${json}${eol}` : json
}

function parseJSON(content, file) {
  try {
    return JSON.parse(content)
  } catch (error) {
    fail(`Could not parse ${relative(file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function change(file, original, content) {
  return { path: file, relativePath: relative(file), original, content }
}

function printPlan(plan) {
  console.log(`${dryRun ? "Would prepare" : "Preparing"} ${tag} (${version}) on ${plan.branch}:`)
  for (const item of plan.changes) console.log(`  ${item.relativePath}`)
  console.log(`${plan.changes.length} version file(s) ${dryRun ? "would be updated" : "will be updated"}.`)
  if (!dryRun) console.log(`Then commit, create annotated tag ${tag}, and atomically push ${plan.branch} + ${tag} to ${remote}.`)
}

function parseArgs(values) {
  let releaseTag
  let remoteName = "origin"
  let isDryRun = false

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--dry-run") {
      isDryRun = true
      continue
    }
    if (value === "--remote") {
      remoteName = values[++index]
      if (!remoteName) usage("--remote requires a name")
      continue
    }
    if (value === "--help" || value === "-h") usage()
    if (value.startsWith("-")) usage(`Unknown option: ${value}`)
    if (releaseTag) usage("Only one release tag may be specified")
    releaseTag = value
  }

  if (!releaseTag) usage("A release tag is required")
  const match = releaseTag.match(/^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/)
  if (!match) usage(`Invalid release tag: ${releaseTag}. Expected v<semver>, for example v0.1.0-rc.20.`)
  return { tag: releaseTag, version: match[1], remote: remoteName, dryRun: isDryRun }
}

function run(command, args, { inherit = false } = {}) {
  const result = spawn(command, args, inherit)
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`)
  return result
}

function spawn(command, args, inherit = false) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`)
  return { ...result, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

function shortHead() {
  return run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim()
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/")
}

function usage(error) {
  if (error) console.error(error)
  console.error("Usage: node scripts/release-tag.mjs <v-semver> [--dry-run] [--remote origin]")
  process.exit(error ? 1 : 0)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

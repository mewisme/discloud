import fs from "fs"

const command = process.argv[2]
const args = parseArgs(process.argv.slice(3))

switch (command) {
  case "validate":
    await validateManifest(args.manifest, args.tag)
    break
  case "compare":
    compareManifests(args.candidate, args.current)
    break
  default:
    fail("Usage: tauri-updater-release.js validate --manifest <file> --tag <tag> | compare --candidate <file> --current <file>")
}

async function validateManifest(file, tag) {
  if (!file || !tag) fail("validate requires --manifest and --tag")

  const manifest = readJSON(file)
  const expectedVersion = tag.replace(/^v/, "")

  if (manifest.version !== expectedVersion) {
    fail(`Updater manifest version ${manifest.version ?? "<missing>"} does not match release tag ${tag}`)
  }

  if (!manifest.platforms || typeof manifest.platforms !== "object" || Array.isArray(manifest.platforms)) {
    fail("Updater manifest has no platforms object")
  }

  const entries = Object.entries(manifest.platforms)
  if (entries.length === 0) fail("Updater manifest has no platform entries")

  const platformKeys = entries.map(([platform]) => platform)
  for (const required of ["windows-x86_64", "linux-x86_64", "darwin-aarch64", "darwin-x86_64"]) {
    if (!platformKeys.some((platform) => platform === required || platform.startsWith(`${required}-`))) {
      fail(`Updater manifest is missing required platform ${required}`)
    }
  }

  const releaseAssets = await getReleaseAssets(tag)
  const allowedUrls = new Set()
  for (const asset of releaseAssets) {
    if (typeof asset.url === "string") allowedUrls.add(asset.url)
    if (typeof asset.browser_download_url === "string") allowedUrls.add(asset.browser_download_url)
  }

  for (const [platform, release] of entries) {
    if (!release || typeof release !== "object") fail(`Invalid platform entry: ${platform}`)
    if (typeof release.signature !== "string" || !release.signature.trim()) fail(`Missing signature for ${platform}`)
    if (typeof release.url !== "string" || !release.url.trim()) fail(`Missing download URL for ${platform}`)

    let url
    try {
      url = new URL(release.url)
    } catch {
      fail(`Invalid download URL for ${platform}: ${release.url}`)
    }

    if (url.protocol !== "https:") fail(`Updater URL for ${platform} must use HTTPS`)
    if (!allowedUrls.has(release.url)) fail(`Updater URL for ${platform} does not belong to exact release ${tag}: ${release.url}`)
  }

  console.log(`Validated updater manifest v${manifest.version} with ${entries.length} platform entries for ${tag}.`)
}

async function getReleaseAssets(tag) {
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) fail("GITHUB_REPOSITORY must be set to owner/repo")

  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "")
  const release = await requestJSON(`${apiBase}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`)
  if (!Number.isInteger(release.id)) fail(`Could not resolve release id for ${tag}`)

  const assets = []
  for (let page = 1; ; page += 1) {
    const batch = await requestJSON(`${apiBase}/repos/${repository}/releases/${release.id}/assets?per_page=100&page=${page}`)
    if (!Array.isArray(batch)) fail(`Invalid release assets response for ${tag}`)
    assets.push(...batch)
    if (batch.length < 100) break
  }
  if (assets.length === 0) fail(`Release ${tag} has no assets`)
  return assets
}

async function requestJSON(url) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "DisCloud-release" }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(url, { headers })
  } catch (error) {
    fail(`Could not request GitHub API: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) fail(`GitHub API request failed: ${response.status} ${response.statusText}`)
  return response.json()
}

function compareManifests(candidateFile, currentFile) {
  if (!candidateFile || !currentFile) fail("compare requires --candidate and --current")

  const candidate = readJSON(candidateFile)
  const current = readJSON(currentFile)
  const result = compareVersions(candidate.version, current.version)

  if (result < 0) {
    console.log(`skip: candidate ${candidate.version} is older than current ${current.version}`)
    process.exit(3)
  }

  console.log(`promote: candidate ${candidate.version} >= current ${current.version}`)
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)

  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (av === bv) continue

    const an = /^\d+$/.test(av)
    const bn = /^\d+$/.test(bv)
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1
    if (an !== bn) return an ? -1 : 1
    return av > bv ? 1 : -1
  }

  return 0
}

function parseVersion(value) {
  if (typeof value !== "string") fail(`Invalid updater version: ${String(value)}`)

  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) fail(`Invalid semantic version: ${value}`)

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  }
}

function parseArgs(values) {
  const result = {}

  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith("--") || value === undefined) fail(`Invalid argument: ${key ?? "<missing>"}`)
    result[key.slice(2)] = value
  }

  return result
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    fail(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

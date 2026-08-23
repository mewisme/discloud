import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const tauriConfigPath = path.join(repoRoot, "desktop", "src-tauri", "tauri.conf.json")
const channelsPath = path.join(repoRoot, "desktop", "src-tauri", "updater-channels.json")
const channelNames = ["stable", "rc", "beta", "alpha"]

function main() {
  if (process.argv.includes("--check")) {
    validateCommittedConfig()
    return
  }

  const publicKey = requiredEnv("TAURI_SIGNING_PUBLIC_KEY")
  const channels = parseChannels(requiredEnv("TAURI_UPDATER_ENDPOINTS"))
  const version = process.env.TAURI_APP_VERSION?.trim()

  const config = readJSON(tauriConfigPath)
  config.plugins ??= {}
  config.plugins.updater ??= {}
  config.plugins.updater.pubkey = publicKey
  config.plugins.updater.endpoints = channels.stable

  if (version) {
    if (!isVersion(version)) fail(`Invalid TAURI_APP_VERSION: ${version}`)
    config.version = version
  }

  writeJSON(tauriConfigPath, config)
  writeJSON(channelsPath, channels)

  console.log(`Configured Tauri updater for ${version ? `v${version}` : "the current app version"} with stable, rc, beta and alpha channels.`)
}

function validateCommittedConfig() {
  const config = readJSON(tauriConfigPath)
  const channels = normalizeChannels(readJSON(channelsPath))
  const stable = config?.plugins?.updater?.endpoints

  if (!Array.isArray(stable) || stable.length === 0) fail("tauri.conf.json must contain at least one updater endpoint")
  validateEndpoints(stable, "tauri.conf.json updater endpoints")

  if (JSON.stringify(stable) !== JSON.stringify(channels.stable)) {
    fail("tauri.conf.json updater endpoints must match the stable channel in updater-channels.json")
  }

  console.log("Tauri updater channel configuration is valid.")
}

function parseChannels(raw) {
  let parsed

  try {
    parsed = JSON.parse(raw)
  } catch {
    fail("TAURI_UPDATER_ENDPOINTS must be a JSON object containing stable, rc, beta and alpha endpoints")
  }

  return normalizeChannels(parsed)
}

function normalizeChannels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Updater channels must be a JSON object")

  const source = { ...value }
  if (source.latest && !source.stable) source.stable = source.latest

  const channels = {}
  for (const name of channelNames) {
    const raw = source[name]
    const endpoints = typeof raw === "string" ? [raw] : raw

    if (!Array.isArray(endpoints) || endpoints.length === 0) fail(`Updater channel ${name} must contain at least one endpoint`)

    channels[name] = endpoints.map((endpoint) => {
      if (typeof endpoint !== "string" || !endpoint.trim()) fail(`Updater channel ${name} contains an invalid endpoint`)
      return endpoint.trim()
    })

    validateEndpoints(channels[name], `updater channel ${name}`)
  }

  return channels
}

function validateEndpoints(endpoints, label) {
  for (const endpoint of endpoints) {
    let url

    try {
      url = new URL(endpoint)
    } catch {
      fail(`Invalid URL in ${label}: ${endpoint}`)
    }

    if (url.protocol !== "https:") fail(`Updater endpoints must use HTTPS: ${endpoint}`)
  }
}

function isVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) fail(`${name} environment variable is not set`)
  return value
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    fail(`Could not read ${path.relative(repoRoot, file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

main()

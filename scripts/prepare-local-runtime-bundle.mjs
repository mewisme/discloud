import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"

process.noDeprecation = true

const POSTGRESQL_VERSION = "18.6.0"
const targets = {
  "x86_64-unknown-linux-gnu": { backendOs: "linux", backendArch: "amd64", backendArchive: "tar.gz", backendBinary: "discloud", webOs: "linux", webArch: "amd64" },
  "x86_64-pc-windows-msvc": { backendOs: "windows", backendArch: "amd64", backendArchive: "zip", backendBinary: "discloud.exe", webOs: "windows", webArch: "amd64" },
  "aarch64-apple-darwin": { backendOs: "darwin", backendArch: "arm64", backendArchive: "tar.gz", backendBinary: "discloud", webOs: "darwin", webArch: "arm64" },
  "x86_64-apple-darwin": { backendOs: "darwin", backendArch: "amd64", backendArchive: "tar.gz", backendBinary: "discloud", webOs: "darwin", webArch: "amd64" },
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log("Usage: node scripts/prepare-local-runtime-bundle.mjs --version <version> --target <target-triple> --output <directory>")
  process.exit(0)
}
if (!args.version || !args.target || !args.output) throw new Error("--version, --target and --output are required")
const target = targets[args.target]
if (!target) throw new Error(`Unsupported target: ${args.target}`)

const version = args.version.replace(/^v/, "")
const releaseBase = `https://github.com/mewisme/discloud/releases/download/v${version}`
const postgresqlBase = `https://github.com/mewisme/postgresql-binaries/releases/download/${POSTGRESQL_VERSION}`
const backendArchiveName = `discloud-backend_${version}_${target.backendOs}_${target.backendArch}.${target.backendArchive}`
const webArchiveName = `discloud-web_${version}_${target.webOs}_${target.webArch}.tar.gz`
const postgresqlArchiveName = `postgresql-${POSTGRESQL_VERSION}-${args.target}.tar.gz`
const output = path.resolve(args.output)
const binariesDir = path.join(output, "binaries")
const resourcesDir = path.join(output, "resources", "local-runtime")
const temporary = await mkdtemp(path.join(tmpdir(), "discloud-local-runtime-"))

try {
  await mkdir(binariesDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })

  const backendArchive = path.join(temporary, backendArchiveName)
  const backendChecksums = await downloadText(`${releaseBase}/discloud-backend-checksums.txt`)
  await downloadFile(`${releaseBase}/${backendArchiveName}`, backendArchive)
  await verifyChecksum(backendArchive, checksumFor(backendChecksums, backendArchiveName))

  const webArchive = path.join(temporary, webArchiveName)
  const webChecksums = await downloadText(`${releaseBase}/discloud-web-checksums.txt`)
  await downloadFile(`${releaseBase}/${webArchiveName}`, webArchive)
  await verifyChecksum(webArchive, checksumFor(webChecksums, webArchiveName))

  const postgresqlArchive = path.join(temporary, postgresqlArchiveName)
  const postgresqlChecksum = await downloadText(`${postgresqlBase}/${postgresqlArchiveName}.sha256`)
  await downloadFile(`${postgresqlBase}/${postgresqlArchiveName}`, postgresqlArchive)
  await verifyChecksum(postgresqlArchive, checksumFor(postgresqlChecksum, postgresqlArchiveName, true))

  const webExtracted = path.join(temporary, "web")
  const postgresqlExtracted = path.join(temporary, "postgresql")
  await extractTarGz(webArchive, webExtracted)
  await extractTarGz(postgresqlArchive, postgresqlExtracted)
  for (const required of ["managed-web-runtime.cjs", path.join("web", "server.js"), path.join("web", ".next", "server")]) {
    if (!(await pathExists(path.join(webExtracted, required)))) throw new Error(`Web archive is missing ${required}`)
  }
  const postgresqlBinary = await findFile(postgresqlExtracted, args.target.includes("windows") ? "postgres.exe" : "postgres")
  if (!postgresqlBinary || path.basename(path.dirname(postgresqlBinary)) !== "bin") {
    throw new Error("PostgreSQL archive does not contain bin/postgres")
  }
  const postgresqlRoot = path.dirname(path.dirname(postgresqlBinary))
  const webResource = path.join(resourcesDir, "web", version)
  const postgresqlResource = path.join(resourcesDir, "postgresql", POSTGRESQL_VERSION)
  await copyWebResource(webExtracted, webResource)
  await cp(postgresqlRoot, postgresqlResource, { recursive: true, dereference: true })
  if (await findDirectory(webResource, ".pnpm")) throw new Error("Prepared Web resource still contains the pnpm virtual store")
  if (!(await pathExists(path.join(webResource, "web", "node_modules", "next", "package.json")))) throw new Error("Prepared Web resource is missing flattened Next.js dependencies")

  const extracted = path.join(temporary, "backend")
  await mkdir(extracted, { recursive: true })
  if (target.backendArchive === "zip") execFileSync("unzip", ["-q", backendArchive, "-d", extracted], { stdio: "inherit" })
  else execFileSync("tar", ["-xzf", backendArchive, "-C", extracted], { stdio: "inherit" })
  const backendBinary = await findFile(extracted, target.backendBinary)
  if (!backendBinary) throw new Error(`Backend archive does not contain ${target.backendBinary}`)
  const sidecarExtension = args.target.includes("windows") ? ".exe" : ""
  const sidecar = path.join(binariesDir, `discloud-backend-${args.target}${sidecarExtension}`)
  await copyFile(backendBinary, sidecar)
  if (!sidecarExtension) await chmod(sidecar, 0o755)

  console.log(`Prepared Local runtime bundle for ${args.target}`)
  console.log(`Backend: ${sidecar}`)
  console.log(`PostgreSQL: ${postgresqlResource}`)
  console.log(`Web: ${webResource}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (value === "--help" || value === "-h") result.help = true
    else if (value.startsWith("--")) result[value.slice(2)] = values[++index]
    else throw new Error(`Unexpected argument: ${value}`)
  }
  return result
}

async function downloadFile(url, destination) {
  const response = await fetchWithRetry(url)
  if (!response.body) throw new Error(`Download response has no body: ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

async function downloadText(url) {
  const response = await fetchWithRetry(url)
  return response.text()
}

async function fetchWithRetry(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: githubHeaders(url) })
      if (response.ok) return response
      lastError = new Error(`Download failed (${response.status}): ${url}`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts) await delay(attempt * 1500)
  }
  throw lastError ?? new Error(`Download failed: ${url}`)
}

function githubHeaders(url) {
  const token = process.env.GITHUB_TOKEN?.trim()
  return token && new URL(url).hostname === "github.com" ? { Authorization: `Bearer ${token}` } : {}
}

function checksumFor(content, filename, allowUnnamed = false) {
  const lines = content.split(/\r?\n/).filter(Boolean)
  const namedLine = lines.find((value) => value.includes(filename))
  const namedChecksum = namedLine?.match(/\b[a-fA-F0-9]{64}\b/)?.[0]
  if (namedChecksum) return namedChecksum.toLowerCase()
  if (allowUnnamed) {
    for (const line of lines) {
      const checksum = line.match(/\b[a-fA-F0-9]{64}\b/)?.[0]
      if (checksum) return checksum.toLowerCase()
    }
  }
  throw new Error(`Checksum not found for ${filename}`)
}

async function verifyChecksum(file, expected) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const actual = hash.digest("hex")
  if (actual !== expected) throw new Error(`Checksum mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}`)
}

async function findFile(directory, filename) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name)
    if (entry.isFile() && entry.name === filename) return candidate
    if (entry.isDirectory()) {
      const found = await findFile(candidate, filename)
      if (found) return found
    }
  }
  return null
}

async function findDirectory(directory, dirname) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(directory, entry.name)
    if (entry.name === dirname) return candidate
    const found = await findDirectory(candidate, dirname)
    if (found) return found
  }
  return null
}

async function extractTarGz(archive, destination) {
  await mkdir(destination, { recursive: true })
  execFileSync("tar", ["-xzf", archive, "-C", destination], { stdio: "inherit" })
}

async function copyWebResource(source, destination) {
  const pnpmStore = `${path.sep}node_modules${path.sep}.pnpm${path.sep}`
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter(sourcePath) {
      return !(sourcePath + path.sep).includes(pnpmStore)
    },
  })
}

async function pathExists(candidate) {
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

process.noDeprecation = true

const releaseAPI = "https://api.github.com/repos/shaka-project/static-ffmpeg-binaries/releases/latest"
const targets = {
  "x86_64-unknown-linux-gnu": { asset: "ffmpeg-linux-x64", build: "linux-amd64", extension: "" },
  "x86_64-pc-windows-msvc": { asset: "ffmpeg-win-x64.exe", build: "windows-amd64", extension: ".exe" },
  "aarch64-apple-darwin": { asset: "ffmpeg-osx-arm64", build: "darwin-arm64", extension: "" },
  "x86_64-apple-darwin": { asset: "ffmpeg-osx-x64", build: "darwin-amd64", extension: "" },
}

const options = parseArgs(process.argv.slice(2))
const target = targets[options.target]
if (!target) fail(`Unsupported FFmpeg target: ${options.target}`)
const outputDirectory = path.resolve(options.output)
const staged = path.join(outputDirectory, `ffmpeg-${options.target}${target.extension}`)
fs.mkdirSync(outputDirectory, { recursive: true })
fs.rmSync(staged, { force: true })

if (options.forceBuild) {
  buildFallback(target, staged)
} else {
  const prepared = await preparePrebuilt(target, staged)
  if (!prepared) buildFallback(target, staged)
}

if (!fs.existsSync(staged) || fs.statSync(staged).size === 0) fail("FFmpeg staging produced no binary")
if (process.platform !== "win32") fs.chmodSync(staged, 0o755)
console.log(`Prepared ${staged}`)

async function preparePrebuilt(target, staged) {
  const release = await requestJSON(releaseAPI)
  const asset = release.assets?.find((item) => item.name === target.asset)
  if (!asset) {
    console.log(`No prebuilt ${target.asset}; building FFmpeg instead.`)
    return false
  }
  const digest = typeof asset.digest === "string" ? asset.digest : ""
  if (!digest.startsWith("sha256:") || digest.length !== 71) {
    console.log(`Prebuilt ${target.asset} has no SHA-256 digest; building FFmpeg instead.`)
    return false
  }

  const temporary = path.join(os.tmpdir(), `discloud-${process.pid}-${Date.now()}-${target.asset}`)
  try {
    await download(asset.browser_download_url, temporary)
    const actual = sha256(temporary)
    const expected = digest.slice("sha256:".length).toLowerCase()
    if (actual !== expected) fail(`FFmpeg checksum mismatch for ${target.asset}: expected ${expected}, got ${actual}`)
    fs.copyFileSync(temporary, staged)
    console.log(`Verified ${target.asset} sha256:${actual}`)
    console.log("Prebuilt asset contains only ffmpeg; no ffprobe or ffplay is staged.")
    return true
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function buildFallback(target, staged) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "discloud-ffmpeg-build-"))
  try {
    const mount = `"${temporary}:/output"`
    const result = spawnSync("docker", ["run", "--rm", "-v", mount, "ghcr.io/binmgr/ffmpeg:build", "build-ffmpeg", target.build], { stdio: "inherit", shell: true })
    if (result.error) throw result.error
    if (result.status !== 0) fail(`FFmpeg source build failed (exit ${result.status ?? "unknown"})`)
    const built = path.join(temporary, `ffmpeg-${target.build}${target.extension}`)
    if (!fs.existsSync(built)) fail(`FFmpeg source build did not produce ${path.basename(built)}`)
    fs.copyFileSync(built, staged)
    console.log(`Built FFmpeg for ${target.build}; staged only ${path.basename(staged)}.`)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

async function requestJSON(url) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "DisCloud-release" }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers })
  if (!response.ok) fail(`Could not resolve FFmpeg release: ${response.status} ${response.statusText}`)
  return response.json()
}

async function download(url, destination) {
  const headers = { "User-Agent": "DisCloud-release" }
  if (process.env.GITHUB_TOKEN && url.includes("github.com")) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers, redirect: "follow" })
  if (!response.ok) fail(`Could not download FFmpeg: ${response.status} ${response.statusText}`)
  const data = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(destination, data)
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

function parseArgs(args) {
  const options = { target: "", output: "", forceBuild: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--target") options.target = args[++i] ?? ""
    else if (arg === "--output") options.output = args[++i] ?? ""
    else if (arg === "--force-build") options.forceBuild = true
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/prepare-ffmpeg-sidecar.js --target <tauri-target-triple> --output <directory> [--force-build]")
      process.exit(0)
    } else fail(`Unknown argument: ${arg}`)
  }
  if (!options.target) fail("--target is required")
  if (!options.output) fail("--output is required")
  return options
}

function fail(message) {
  throw new Error(message)
}

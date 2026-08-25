const fs = require("node:fs")
const path = require("node:path")

const shutdownFile = process.env.DISCLOUD_MANAGED_WEB_SHUTDOWN_FILE
if (!shutdownFile) throw new Error("DISCLOUD_MANAGED_WEB_SHUTDOWN_FILE is required")

require(path.join(__dirname, "web", "server.js"))

const watcher = setInterval(() => {
  if (!fs.existsSync(shutdownFile)) return
  try { fs.rmSync(shutdownFile, { force: true }) } catch {}
  if (!process.emit("SIGTERM", "SIGTERM")) process.exit(0)
}, 250)
watcher.unref()

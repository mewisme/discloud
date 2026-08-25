const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const png = path.join(root, "desktop", "src-tauri", "icons", "icon.png")
const ico = path.join(root, "desktop", "src-tauri", "icons", "icon.ico")
const targets = [
  [png, path.join(root, "desktop", "public", "app-icon.png")],
  [png, path.join(root, "web", "public", "app-icon.png")],
  [ico, path.join(root, "web", "src", "app", "favicon.ico")],
]

for (const [source, destination] of targets) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (fs.existsSync(destination) && fs.readFileSync(source).equals(fs.readFileSync(destination))) continue
  fs.copyFileSync(source, destination)
}

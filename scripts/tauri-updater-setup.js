import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function tauriUpdaterSetup() {
  const pubkey = process.env.TAURI_SIGNING_PUBLIC_KEY;
  const endpoints = process.env.TAURI_UPDATER_ENDPOINTS;

  if (!pubkey) {
    console.error("TAURI_SIGNING_PUBLIC_KEY environment variable is not set");
    process.exit(1);
  }

  if (!endpoints) {
    console.error("TAURI_UPDATER_ENDPOINTS environment variable is not set");
    process.exit(1);
  }

  const parsedEndpoints = endpoints.split(/[,\s|]+/).map(endpoint => endpoint.trim()).filter(Boolean);

  if (!parsedEndpoints.length) {
    console.error("TAURI_UPDATER_ENDPOINTS does not contain any valid endpoints");
    process.exit(1);
  }

  for (const endpoint of parsedEndpoints) {
    try {
      new URL(endpoint);
    } catch {
      console.error(`Invalid Tauri updater endpoint: ${endpoint}`);
      process.exit(1);
    }
  }

  const tauriConfigPath = path.resolve(__dirname, "..", "desktop", "src-tauri", "tauri.conf.json");

  try {
    const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));

    config.plugins ??= {};
    config.plugins.updater ??= {};
    config.plugins.updater.pubkey = pubkey;
    config.plugins.updater.endpoints = parsedEndpoints;

    const updatedContent = JSON.stringify(config, null, 2);
    fs.writeFileSync(tauriConfigPath, updatedContent, "utf8");

    console.log("Updated tauri.conf.json:", updatedContent);
  } catch (error) {
    console.error("Error setting up Tauri updater:", error);
    process.exit(1);
  }
}

tauriUpdaterSetup();
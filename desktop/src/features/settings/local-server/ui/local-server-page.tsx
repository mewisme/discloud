import { Tabs, TabsContent, TabsList, TabsTrigger } from "@discloud/ui/components/tabs"
import { confirm, open, save as saveFile } from "@tauri-apps/plugin-dialog"
import { useCallback, useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"
import { exportLocalDatabase, getLocalServerSettings, importLocalDatabase, type LocalRuntimeSnapshot, type LocalServerSettings, prepareLocalRuntime, restartLocalRuntime, saveLocalServerSettings } from "#lib/local-runtime"
import { normalizeNativePath } from "#lib/native-path"
import { type ConnectionMode, loadConnectionSettings } from "#lib/settings"

import { LocalServerConfiguration } from "./local-server-configuration"
import { LocalServerDatabase } from "./local-server-database"
import { LocalServerOverview } from "./local-server-overview"
import { LocalServerRuntime } from "./local-server-runtime"

export function LocalServerPage() {
  const [settings, setSettings] = useState<LocalServerSettings | null>(null)
  const [runtime, setRuntime] = useState<LocalRuntimeSnapshot | null>(null)
  const [mode, setMode] = useState<ConnectionMode | null>(null)
  const [guildId, setGuildId] = useState("")
  const [channelId, setChannelId] = useState("")
  const [botTokens, setBotTokens] = useState("")
  const [dataDirectory, setDataDirectory] = useState("")
  const [webEnabled, setWebEnabled] = useState(false)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [databaseAction, setDatabaseAction] = useState<"export" | "import">()
  const [databaseMessage, setDatabaseMessage] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const nextSettings = await getLocalServerSettings()
      const [nextRuntime, connection] = await Promise.all([nextSettings.dataCompatibility.compatible ? prepareLocalRuntime() : Promise.resolve(null), loadConnectionSettings()])
      setSettings(nextSettings)
      setRuntime(nextRuntime)
      setMode(connection.mode)
      setGuildId(nextSettings.guildId)
      setChannelId(nextSettings.channelId)
      setDataDirectory(nextSettings.dataDirectory)
      setWebEnabled(nextSettings.webEnabled)
      setError(undefined)
    } catch (error) {
      setError(errorMessage(error))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function save() {
    if (saving || !settings?.dataCompatibility.compatible) return
    setSaving(true)
    setError(undefined)
    try {
      const nextSettings = await saveLocalServerSettings({ guildId, channelId, botTokens: botTokens || undefined, dataDirectory, webEnabled })
      setSettings(nextSettings)
      setBotTokens("")
      setRuntime(await prepareLocalRuntime())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function restart() {
    if (restarting || mode !== "local" || !settings?.dataCompatibility.compatible) return
    setRestarting(true)
    setError(undefined)
    try {
      await restartLocalRuntime()
      setRuntime(await prepareLocalRuntime())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setRestarting(false)
    }
  }

  async function pickDataDirectory() {
    if (!settings || settings.dataDirectoryLocked || !settings.dataCompatibility.compatible) return
    const selected = await open({ directory: true, multiple: false, defaultPath: dataDirectory || undefined })
    if (typeof selected === "string") setDataDirectory(normalizeNativePath(selected))
  }

  async function exportDatabase() {
    if (databaseAction || !runtime?.postgresql?.initialized || !settings?.dataCompatibility.compatible) return
    const destination = await saveFile({
      defaultPath: databaseBackupName(),
      filters: [{ name: "PostgreSQL custom backup", extensions: ["dump"] }],
    })
    if (!destination) return
    setDatabaseAction("export"); setDatabaseMessage(undefined); setError(undefined)
    try {
      const result = await exportLocalDatabase(destination)
      setDatabaseMessage(`Database exported successfully (${formatBytes(result.bytes)}).`)
      setRuntime(await prepareLocalRuntime())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setDatabaseAction(undefined)
    }
  }

  async function importDatabase() {
    if (databaseAction || !settings?.dataCompatibility.compatible) return
    const source = await open({ multiple: false, directory: false, filters: [{ name: "PostgreSQL custom backup", extensions: ["dump"] }] })
    if (typeof source !== "string") return
    const accepted = await confirm("The selected backup will be validated and restored into a temporary database before replacing the current Local server database. The runtime may restart and you may need to sign in again.", { title: "Import Local server database", kind: "warning" })
    if (!accepted) return
    setDatabaseAction("import"); setDatabaseMessage(undefined); setError(undefined)
    try {
      setRuntime(await importLocalDatabase(source))
      setSettings(await getLocalServerSettings())
      setDatabaseMessage("Database imported and validated successfully. You may need to sign in again if the restored backup contains different sessions.")
    } catch (error) {
      setError(errorMessage(error))
      try { setRuntime(await prepareLocalRuntime()) } catch { setRuntime(null) }
    } finally {
      setDatabaseAction(undefined)
    }
  }

  if (!settings) {
    return (
      <section className="space-y-4">
        <div><h2 className="text-lg font-semibold">Local Server</h2><p className="text-sm text-muted-foreground">Manage the embedded PostgreSQL, backend and optional Web UI.</p></div>
        <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{error ?? "Loading Local server settings..."}</div>
      </section>
    )
  }

  const configured = !!guildId.trim() && !!channelId.trim() && settings.botTokensConfigured && settings.encryptionKeyConfigured && settings.databasePasswordConfigured

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Local Server</h2>
        <p className="text-sm text-muted-foreground">Manage the embedded PostgreSQL, DisCloud backend and optional managed Web UI.</p>
      </div>

      {!settings.dataCompatibility.compatible ? <p className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{settings.dataCompatibility.detail ?? "Update DisCloud before using this Local data directory."}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4"><LocalServerOverview settings={settings} runtime={runtime} /></TabsContent>
        <TabsContent value="configuration" className="mt-4">
          <LocalServerConfiguration settings={settings} guildId={guildId} channelId={channelId} botTokens={botTokens} webEnabled={webEnabled} saving={saving} onGuildIdChange={setGuildId} onChannelIdChange={setChannelId} onBotTokensChange={setBotTokens} onWebEnabledChange={setWebEnabled} onSave={() => void save()} />
        </TabsContent>
        <TabsContent value="runtime" className="mt-4"><LocalServerRuntime settings={settings} runtime={runtime} mode={mode} restarting={restarting} configured={configured} onRestart={() => void restart()} /></TabsContent>
        <TabsContent value="database" className="mt-4"><LocalServerDatabase settings={settings} runtime={runtime} dataDirectory={dataDirectory} saving={saving} databaseAction={databaseAction} databaseMessage={databaseMessage} onPickDataDirectory={() => void pickDataDirectory()} onSave={() => void save()} onExport={() => void exportDatabase()} onImport={() => void importDatabase()} /></TabsContent>
      </Tabs>
    </section>
  )
}

function databaseBackupName() {
  const now = new Date()
  const stamp = [now.getFullYear(), `${now.getMonth() + 1}`.padStart(2, "0"), `${now.getDate()}`.padStart(2, "0"), "-", `${now.getHours()}`.padStart(2, "0"), `${now.getMinutes()}`.padStart(2, "0"), `${now.getSeconds()}`.padStart(2, "0")].join("")
  return `discloud-${stamp}.dump`
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const size = value / 1024 ** unit
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

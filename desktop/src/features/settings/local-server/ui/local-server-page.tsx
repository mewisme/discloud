import { Tabs, TabsContent, TabsList, TabsTrigger } from "@discloud/ui/components/tabs"
import { open } from "@tauri-apps/plugin-dialog"
import { useCallback, useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"
import { getLocalServerSettings, type LocalRuntimeSnapshot, type LocalServerSettings, prepareLocalRuntime, restartLocalRuntime, saveLocalServerSettings } from "#lib/local-runtime"
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
    if (typeof selected === "string") setDataDirectory(selected)
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
        <TabsContent value="database" className="mt-4"><LocalServerDatabase settings={settings} dataDirectory={dataDirectory} saving={saving} onPickDataDirectory={() => void pickDataDirectory()} onSave={() => void save()} /></TabsContent>
      </Tabs>
    </section>
  )
}

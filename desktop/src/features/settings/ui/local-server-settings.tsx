import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Field, FieldDescription, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { open } from "@tauri-apps/plugin-dialog"
import { DatabaseIcon, FolderOpenIcon, KeyRoundIcon, LoaderCircle, RefreshCwIcon, ServerIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"
import { getLocalServerSettings, type LocalRuntimeSnapshot, type LocalServerSettings, prepareLocalRuntime, restartLocalRuntime, saveLocalServerSettings } from "#lib/local-runtime"
import { type ConnectionMode, loadConnectionSettings } from "#lib/settings"

export function LocalServerSettings() {
  const [settings, setSettings] = useState<LocalServerSettings | null>(null)
  const [runtime, setRuntime] = useState<LocalRuntimeSnapshot | null>(null)
  const [mode, setMode] = useState<ConnectionMode | null>(null)
  const [guildId, setGuildId] = useState("")
  const [channelId, setChannelId] = useState("")
  const [botTokens, setBotTokens] = useState("")
  const [dataDirectory, setDataDirectory] = useState("")
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [nextSettings, nextRuntime, connection] = await Promise.all([getLocalServerSettings(), prepareLocalRuntime(), loadConnectionSettings()])
      setSettings(nextSettings)
      setRuntime(nextRuntime)
      setMode(connection.mode)
      setGuildId(nextSettings.guildId)
      setChannelId(nextSettings.channelId)
      setDataDirectory(nextSettings.dataDirectory)
      setError(undefined)
    } catch (error) {
      setError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save() {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      const nextSettings = await saveLocalServerSettings({ guildId, channelId, botTokens: botTokens || undefined, dataDirectory })
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
    if (restarting || mode !== "local") return
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
    if (settings?.dataDirectoryLocked) return
    const selected = await open({ directory: true, multiple: false, defaultPath: dataDirectory || undefined })
    if (typeof selected === "string") setDataDirectory(selected)
  }

  const configured = !!guildId.trim() && !!channelId.trim() && !!settings?.botTokensConfigured && !!settings.encryptionKeyConfigured && !!settings.databasePasswordConfigured
  const backendPort = runtime?.backend?.port ?? settings?.backendPreferredPort
  const postgresqlPort = runtime?.postgresql?.port ?? settings?.postgresqlPreferredPort

  return (
    <Card>
      <CardHeader>
        <CardTitle>Local server</CardTitle>
        <CardDescription>Configure the managed PostgreSQL and DisCloud backend that run with Desktop.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <RuntimeItem icon={ServerIcon} label="Backend" status={runtime?.backend?.running ? "Running" : "Stopped"} detail={`127.0.0.1:${backendPort ?? "-"}`} />
          <RuntimeItem icon={DatabaseIcon} label="PostgreSQL" status={runtime?.postgresql?.running ? "Running" : "Stopped"} detail={`127.0.0.1:${postgresqlPort ?? "-"}`} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="desktop-local-guild-id">Discord guild ID</FieldLabel>
            <Input id="desktop-local-guild-id" value={guildId} inputMode="numeric" onChange={(event) => setGuildId(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="desktop-local-channel-id">Storage channel ID</FieldLabel>
            <Input id="desktop-local-channel-id" value={channelId} inputMode="numeric" onChange={(event) => setChannelId(event.target.value)} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="desktop-local-bot-tokens">Discord bot token{settings?.botTokensConfigured ? " (configured)" : ""}</FieldLabel>
          <Input id="desktop-local-bot-tokens" type="password" value={botTokens} autoComplete="off" placeholder={settings?.botTokensConfigured ? "Leave blank to keep stored token" : "Bot token, or comma-separated tokens"} onChange={(event) => setBotTokens(event.target.value)} />
          <FieldDescription>Stored in the OS keyring. The saved token is never returned to the UI.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="desktop-local-data-directory">Local data directory</FieldLabel>
          <div className="flex gap-2">
            <Input id="desktop-local-data-directory" className="min-w-0" value={dataDirectory} readOnly />
            <Button type="button" variant="outline" disabled={!!settings?.dataDirectoryLocked} onClick={() => void pickDataDirectory()}>
              <FolderOpenIcon data-icon="inline-start" />Browse
            </Button>
          </div>
          <FieldDescription>{settings?.dataDirectoryLocked ? "The directory is locked after PostgreSQL initialization. Data migration will require a separate flow." : `Default: ${settings?.defaultDataDirectory ?? "-"}`}</FieldDescription>
        </Field>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <SecretState label="Bot token" configured={!!settings?.botTokensConfigured} />
          <SecretState label="Encryption key" configured={!!settings?.encryptionKeyConfigured} />
          <SecretState label="Database password" configured={!!settings?.databasePasswordConfigured} />
        </div>

        <div className="rounded-lg border p-3 text-sm text-muted-foreground">
          Preferred ports: backend {settings?.backendPreferredPort ?? 27831}, PostgreSQL {settings?.postgresqlPreferredPort ?? 27832}, web {settings?.webPreferredPort ?? 27833}. Persisted ports are reused when available; conflicts fall back inside 27834–27999.
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={saving || !guildId.trim() || !channelId.trim() || (!botTokens.trim() && !settings?.botTokensConfigured)} onClick={() => void save()}>
            {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}Save settings
          </Button>
          <Button type="button" variant="outline" disabled={restarting || mode !== "local" || !configured} onClick={() => void restart()}>
            {restarting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCwIcon data-icon="inline-start" />}Restart local server
          </Button>
          {mode !== "local" ? <span className="self-center text-sm text-muted-foreground">Switch the active connection to Local before restarting.</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

type RuntimeItemProps = { icon: typeof ServerIcon; label: string; status: string; detail: string }

function RuntimeItem({ icon: Icon, label, status, detail }: RuntimeItemProps) {
  return <div className="flex items-center gap-3 rounded-lg border p-3"><Icon className="size-4 text-muted-foreground" /><div className="min-w-0"><div className="font-medium">{label}</div><div className="text-sm text-muted-foreground">{status} · {detail}</div></div></div>
}

function SecretState({ label, configured }: { label: string; configured: boolean }) {
  return <div className="flex items-center gap-2 rounded-lg border px-3 py-2"><KeyRoundIcon className="size-4 text-muted-foreground" /><span>{label}: {configured ? "Configured" : "Missing"}</span></div>
}

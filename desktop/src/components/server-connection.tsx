import { AuthShell } from "@discloud/app-ui/auth/auth-shell"
import { Button } from "@discloud/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@discloud/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { open } from "@tauri-apps/plugin-dialog"
import { LoaderCircle } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import { connectLocalRuntime, connectServer, errorMessage, type ServerConnection } from "#lib/instance"
import { getLocalServerSettings, type LocalServerSettings, saveLocalServerSettings } from "#lib/local-runtime"
import { type ConnectionMode, loadConnectionSettings, saveConnectionMode, saveRemoteConnection } from "#lib/settings"

type ServerConnectionScreenProps = {
  initialServerUrl?: string
  initialError?: string
  onConnected: (connection: ServerConnection) => void
}

export function ServerConnectionScreen({
  initialServerUrl = "",
  initialError,
  onConnected,
}: ServerConnectionScreenProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const [mode, setMode] = useState<ConnectionMode>("remote")
  const [localSettings, setLocalSettings] = useState<LocalServerSettings | null>(null)
  const [guildId, setGuildId] = useState("")
  const [channelId, setChannelId] = useState("")
  const [botTokens, setBotTokens] = useState("")
  const [dataDirectory, setDataDirectory] = useState("")
  const [error, setError] = useState(initialError)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    void loadConnectionSettings().then((settings) => {
      if (settings.mode) setMode(settings.mode)
    })
  }, [])

  useEffect(() => {
    if (mode !== "local" || localSettings) return
    void getLocalServerSettings()
      .then((settings) => {
        setLocalSettings(settings)
        setGuildId(settings.guildId)
        setChannelId(settings.channelId)
        setDataDirectory(settings.dataDirectory)
      })
      .catch((error) => setError(errorMessage(error)))
  }, [localSettings, mode])

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (connecting) return

    setConnecting(true)
    setError(undefined)

    try {
      const connection = await connectServer(serverUrl)

      await saveRemoteConnection(connection.serverUrl)
      setServerUrl(connection.serverUrl)
      onConnected(connection)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setConnecting(false)
    }
  }

  async function connectLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (connecting) return
    setConnecting(true)
    setError(undefined)
    try {
      const settings = await saveLocalServerSettings({ guildId, channelId, botTokens: botTokens || undefined, dataDirectory })
      setLocalSettings(settings)
      setBotTokens("")
      await saveConnectionMode("local")
      onConnected(await connectLocalRuntime())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setConnecting(false)
    }
  }

  async function pickDataDirectory() {
    const selected = await open({ directory: true, multiple: false, defaultPath: dataDirectory || undefined })
    if (typeof selected === "string") setDataDirectory(selected)
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Connect to DisCloud</CardTitle>
          <CardDescription>
            Run DisCloud on this device or connect to an existing server.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Button type="button" variant={mode === "local" ? "default" : "outline"} disabled={connecting} onClick={() => { setMode("local"); setError(undefined) }}>Local</Button>
            <Button type="button" variant={mode === "remote" ? "default" : "outline"} disabled={connecting} onClick={() => { setMode("remote"); setError(undefined) }}>Remote</Button>
          </div>

          {mode === "remote" ? <form className="flex flex-col gap-4" onSubmit={connect}>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="server-url">Server</FieldLabel>
              <Input
                id="server-url"
                type="text"
                value={serverUrl}
                placeholder="https://cloud.example.com"
                aria-invalid={!!error}
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                disabled={connecting}
                onChange={(event) => setServerUrl(event.target.value)}
              />
              <FieldDescription>
                HTTPS is used automatically when no protocol is specified.
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>

            <Button
              type="submit"
              className="w-full"
              disabled={connecting || !serverUrl.trim()}
            >
              {connecting ? (
                <>
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                  Connecting
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </form> : <form className="flex flex-col gap-4" onSubmit={connectLocal}>
            <Field>
              <FieldLabel htmlFor="local-guild-id">Discord guild ID</FieldLabel>
              <Input id="local-guild-id" value={guildId} inputMode="numeric" autoComplete="off" disabled={connecting} onChange={(event) => setGuildId(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="local-channel-id">Storage channel ID</FieldLabel>
              <Input id="local-channel-id" value={channelId} inputMode="numeric" autoComplete="off" disabled={connecting} onChange={(event) => setChannelId(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="local-bot-tokens">Discord bot token{localSettings?.botTokensConfigured ? " (configured)" : ""}</FieldLabel>
              <Input id="local-bot-tokens" type="password" value={botTokens} autoComplete="off" disabled={connecting} placeholder={localSettings?.botTokensConfigured ? "Leave blank to keep stored token" : "Bot token, or comma-separated tokens"} onChange={(event) => setBotTokens(event.target.value)} />
              <FieldDescription>Tokens are stored in the OS keyring and are not written to local-server.env.</FieldDescription>
            </Field>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="local-data-directory">Local data directory</FieldLabel>
              <div className="flex gap-2">
                <Input id="local-data-directory" className="min-w-0" value={dataDirectory} readOnly />
                <Button type="button" variant="outline" disabled={connecting || !!localSettings?.dataDirectoryLocked} onClick={() => void pickDataDirectory()}>Browse</Button>
              </div>
              <FieldDescription>{localSettings?.dataDirectoryLocked ? "The directory is locked after PostgreSQL initialization." : "Runtime, PostgreSQL data, configuration and logs are stored here."}</FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <Button type="submit" className="w-full" disabled={connecting || !guildId.trim() || !channelId.trim() || (!botTokens.trim() && !localSettings?.botTokensConfigured)}>
              {connecting ? <><LoaderCircle data-icon="inline-start" className="animate-spin" />Starting local server</> : "Start local server"}
            </Button>
          </form>}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

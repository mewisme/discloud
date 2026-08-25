import { AuthShell } from "@discloud/app-ui/auth/auth-shell"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Field, FieldDescription, FieldError, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Progress } from "@discloud/ui/components/progress"
import { Questionnaire, QuestionnaireActions, QuestionnaireChoice, QuestionnaireChoiceDescription, QuestionnaireChoices, QuestionnaireDescription, QuestionnaireError, QuestionnaireInput, QuestionnaireItem, QuestionnaireNext, QuestionnairePrevious, QuestionnaireProgress, QuestionnaireSkip, QuestionnaireSubmit, QuestionnaireTitle } from "@discloud/ui/components/questionnaire"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@discloud/ui/components/tabs"
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
      const answers = new FormData(event.currentTarget)
      const guildId = String(answers.get("guildId") ?? "").trim()
      const channelId = String(answers.get("channelId") ?? "").trim()
      const botTokens = String(answers.get("botTokens") ?? "").trim()
      const selectedDataDirectory = String(answers.get("dataDirectory") ?? dataDirectory).trim()
      const webEnabled = answers.get("webEnabled") === "true"
      const settings = await saveLocalServerSettings({ guildId, channelId, botTokens: botTokens || undefined, dataDirectory: selectedDataDirectory, webEnabled })
      setLocalSettings(settings)
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

  function changeMode(value: string) {
    if (value !== "local" && value !== "remote") return
    setMode(value)
    setError(undefined)
  }

  const localSetupItems = localSettings ? [
    { name: "guildId", required: true },
    { name: "channelId", required: true },
    { name: "botTokens", required: !localSettings.botTokensConfigured },
    { name: "dataDirectory", required: true },
    { name: "webEnabled", required: true, choices: [{ value: "true" }, { value: "false" }] },
  ] as const : []

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
          <Tabs value={mode} onValueChange={changeMode}>
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="local" disabled={connecting}>Local</TabsTrigger>
              <TabsTrigger value="remote" disabled={connecting}>Remote</TabsTrigger>
            </TabsList>

            <TabsContent value="remote">
              <form className="flex flex-col gap-4" onSubmit={connect}>
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

                <Button type="submit" className="w-full" disabled={connecting || !serverUrl.trim()}>
                  {connecting ? <><LoaderCircle data-icon="inline-start" className="animate-spin" />Connecting</> : "Connect"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="local">
              {!localSettings ? <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />Loading local server settings</div> : (
                <div className="space-y-4">
                  <Questionnaire items={localSetupItems} onSubmit={connectLocal}>
                    <QuestionnaireProgress
                      className="w-full"
                      render={(props, { current, total }) => {
                        const value = total ? (current / total) * 100 : 0
                        return (
                          <div {...props}>
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                              <span>Step {current} of {total}</span>
                              <span>{Math.round(value)}%</span>
                            </div>
                            <Progress value={value} aria-hidden="true" />
                          </div>
                        )
                      }}
                    />
                    <QuestionnaireItem name="guildId" required>
                      <QuestionnaireTitle>Which Discord server should Local use?</QuestionnaireTitle>
                      <QuestionnaireDescription>Enter the numeric Discord guild ID.</QuestionnaireDescription>
                      <QuestionnaireChoices><QuestionnaireInput aria-label="Discord guild ID" inputMode="numeric" autoComplete="off" disabled={connecting} defaultValue={localSettings.guildId} placeholder="123456789012345678" /></QuestionnaireChoices>
                      <QuestionnaireError>Enter a Discord guild ID to continue.</QuestionnaireError>
                    </QuestionnaireItem>
                    <QuestionnaireItem name="channelId" required>
                      <QuestionnaireTitle>Which channel should store files?</QuestionnaireTitle>
                      <QuestionnaireDescription>Enter the numeric ID of the Discord storage channel.</QuestionnaireDescription>
                      <QuestionnaireChoices><QuestionnaireInput aria-label="Discord storage channel ID" inputMode="numeric" autoComplete="off" disabled={connecting} defaultValue={localSettings.channelId} placeholder="123456789012345678" /></QuestionnaireChoices>
                      <QuestionnaireError>Enter a storage channel ID to continue.</QuestionnaireError>
                    </QuestionnaireItem>
                    <QuestionnaireItem name="botTokens" required={!localSettings.botTokensConfigured}>
                      <QuestionnaireTitle>{localSettings.botTokensConfigured ? `Replace ${localSettings.botTokenCount} stored bot token${localSettings.botTokenCount === 1 ? "" : "s"}?` : "Add Discord bot tokens"}</QuestionnaireTitle>
                      <QuestionnaireDescription>{localSettings.botTokensConfigured ? "Enter a replacement list, or skip to keep the current tokens." : "Separate multiple bot tokens with commas. Each token is stored as its own indexed OS keyring credential."}</QuestionnaireDescription>
                      <QuestionnaireChoices><QuestionnaireInput aria-label="Discord bot tokens" type="password" autoComplete="off" disabled={connecting} placeholder={localSettings.botTokensConfigured ? "New tokens, comma-separated" : "Token, or comma-separated tokens"} /></QuestionnaireChoices>
                      <QuestionnaireError>At least one bot token is required.</QuestionnaireError>
                    </QuestionnaireItem>
                    <QuestionnaireItem name="dataDirectory" required>
                      <QuestionnaireTitle>Where should Local store its data?</QuestionnaireTitle>
                      <QuestionnaireDescription>{localSettings.dataDirectoryLocked ? "The data directory is locked because PostgreSQL has already been initialized." : "This directory stores the managed runtime, PostgreSQL data, configuration, state, and logs."}</QuestionnaireDescription>
                      <QuestionnaireChoices className="grid-cols-[minmax(0,1fr)_auto]">
                        <QuestionnaireInput aria-label="Local data directory" value={dataDirectory} readOnly />
                        <Button type="button" variant="outline" disabled={connecting || localSettings.dataDirectoryLocked} onClick={() => void pickDataDirectory()}>Browse</Button>
                      </QuestionnaireChoices>
                      <QuestionnaireError>Choose a local data directory to continue.</QuestionnaireError>
                    </QuestionnaireItem>
                    <QuestionnaireItem name="webEnabled" required>
                      <QuestionnaireTitle>Enable the managed Web UI?</QuestionnaireTitle>
                      <QuestionnaireDescription>This optional localhost-only Web runtime is managed alongside the backend.</QuestionnaireDescription>
                      <QuestionnaireChoices>
                        <QuestionnaireChoice value="true" defaultChecked={localSettings.webEnabled}><span className="font-medium">Enable Web UI</span><QuestionnaireChoiceDescription>Download and run the matching managed Web runtime.</QuestionnaireChoiceDescription></QuestionnaireChoice>
                        <QuestionnaireChoice value="false" defaultChecked={!localSettings.webEnabled}><span className="font-medium">Desktop only</span><QuestionnaireChoiceDescription>Run only PostgreSQL and the backend.</QuestionnaireChoiceDescription></QuestionnaireChoice>
                      </QuestionnaireChoices>
                      <QuestionnaireError>Choose whether to enable the managed Web UI.</QuestionnaireError>
                    </QuestionnaireItem>
                    <QuestionnaireActions>
                      <QuestionnairePrevious disabled={connecting} />
                      <QuestionnaireSkip disabled={connecting} />
                      <QuestionnaireNext disabled={connecting} />
                      <QuestionnaireSubmit disabled={connecting}>{connecting ? <><LoaderCircle data-icon="inline-start" className="animate-spin" />Starting local server</> : "Start local server"}</QuestionnaireSubmit>
                    </QuestionnaireActions>
                  </Questionnaire>
                  {error ? <FieldError>{error}</FieldError> : null}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

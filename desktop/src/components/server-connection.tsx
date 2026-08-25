import { AuthShell } from "@discloud/app-ui/auth/auth-shell"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { CopyButton } from "@discloud/ui/components/copy-button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Progress } from "@discloud/ui/components/progress"
import { Questionnaire, QuestionnaireActions, QuestionnaireChoice, QuestionnaireChoiceDescription, QuestionnaireChoices, QuestionnaireDescription, QuestionnaireError, QuestionnaireInput, QuestionnaireItem, QuestionnaireNext, QuestionnairePrevious, QuestionnaireProgress, QuestionnaireSkip, QuestionnaireSubmit, QuestionnaireTitle } from "@discloud/ui/components/questionnaire"
import { toast } from "@discloud/ui/components/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@discloud/ui/components/tabs"
import { open } from "@tauri-apps/plugin-dialog"
import { LoaderCircle } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import { advanceLocalProvisioningStage, getLocalProvisioningStage, type LocalProvisioningStage, LocalServerProvisioning } from "#components/local-server-provisioning"
import { connectLocalRuntime, connectServer, errorMessage, type ServerConnection } from "#lib/instance"
import { getLocalRuntimeSnapshot, getLocalServerSettings, type LocalRuntimeSnapshot, type LocalServerSettings, saveLocalServerSettings } from "#lib/local-runtime"
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
  const [provisioning, setProvisioning] = useState(false)
  const [provisioningSnapshot, setProvisioningSnapshot] = useState<LocalRuntimeSnapshot | null>(null)
  const [provisioningStage, setProvisioningStage] = useState<LocalProvisioningStage>("prepare")
  const [provisioningError, setProvisioningError] = useState<string>()

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
      .catch((error) => showLocalSetupError(error, "Could not load Local settings"))
  }, [localSettings, mode])

  useEffect(() => {
    if (!provisioning || !connecting) return
    let cancelled = false
    const webEnabled = localSettings?.webEnabled ?? false
    async function refresh() {
      try {
        const snapshot = await getLocalRuntimeSnapshot()
        if (cancelled) return
        setProvisioningSnapshot(snapshot)
        setProvisioningStage((current) => advanceLocalProvisioningStage(current, getLocalProvisioningStage(snapshot, webEnabled)))
      } catch {
        // The provisioning command reports actionable failures separately.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 250)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connecting, localSettings?.webEnabled, provisioning])

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
      setDataDirectory(settings.dataDirectory)
      await saveConnectionMode("local")
      setProvisioningSnapshot(null)
      setProvisioningStage("prepare")
      setProvisioningError(undefined)
      setProvisioning(true)
      await provisionLocal(settings.webEnabled)
    } catch (error) {
      showLocalSetupError(error, "Could not save Local setup")
    } finally {
      setConnecting(false)
    }
  }

  async function provisionLocal(webEnabled = localSettings?.webEnabled ?? false) {
    setConnecting(true)
    setProvisioningError(undefined)
    try {
      onConnected(await connectLocalRuntime())
    } catch (error) {
      try {
        const snapshot = await getLocalRuntimeSnapshot()
        setProvisioningSnapshot(snapshot)
        setProvisioningStage((current) => advanceLocalProvisioningStage(current, getLocalProvisioningStage(snapshot, webEnabled)))
      } catch {
        // Preserve the provisioning error from the runtime command.
      }
      setProvisioningError(errorMessage(error))
    } finally {
      setConnecting(false)
    }
  }

  async function backToLocalSetup() {
    if (connecting) return
    setProvisioning(false)
    setProvisioningError(undefined)
    setProvisioningSnapshot(null)
    setProvisioningStage("prepare")
    setError(undefined)
    try {
      const settings = await getLocalServerSettings()
      setLocalSettings(settings)
      setDataDirectory(settings.dataDirectory)
    } catch (error) {
      showLocalSetupError(error, "Could not reload Local settings")
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

  if (provisioning && localSettings) {
    return (
      <AuthShell>
        <LocalServerProvisioning
          settings={localSettings}
          snapshot={provisioningSnapshot}
          reachedStage={provisioningStage}
          busy={connecting}
          error={provisioningError}
          onRetry={() => void provisionLocal(localSettings.webEnabled)}
          onBack={() => void backToLocalSetup()}
        />
      </AuthShell>
    )
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
                      <QuestionnaireSubmit disabled={connecting}>{connecting ? <><LoaderCircle data-icon="inline-start" className="animate-spin" />Saving configuration</> : "Save and continue"}</QuestionnaireSubmit>
                    </QuestionnaireActions>
                  </Questionnaire>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

function showLocalSetupError(error: unknown, title: string) {
  const message = errorMessage(error)
  toast.error(title, {
    description: (
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 break-words">{message}</span>
        <CopyButton value={message} label="Copy error" copiedLabel="Error copied" type="button" size="icon-xs" variant="ghost" />
      </div>
    ),
  })
}

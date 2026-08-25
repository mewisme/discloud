import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Field, FieldDescription, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Switch } from "@discloud/ui/components/switch"
import { LoaderCircle } from "lucide-react"

import type { LocalServerSettings } from "#lib/local-runtime"

export type LocalServerConfigurationProps = {
  settings: LocalServerSettings
  guildId: string
  channelId: string
  botTokens: string
  webEnabled: boolean
  saving: boolean
  onGuildIdChange: (value: string) => void
  onChannelIdChange: (value: string) => void
  onBotTokensChange: (value: string) => void
  onWebEnabledChange: (value: boolean) => void
  onSave: () => void
}

export function LocalServerConfiguration({ settings, guildId, channelId, botTokens, webEnabled, saving, onGuildIdChange, onChannelIdChange, onBotTokensChange, onWebEnabledChange, onSave }: LocalServerConfigurationProps) {
  const compatible = settings.dataCompatibility.compatible
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>Configure Discord storage credentials and the optional managed Web UI.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="desktop-local-guild-id">Discord guild ID</FieldLabel>
            <Input id="desktop-local-guild-id" value={guildId} inputMode="numeric" disabled={!compatible || saving} onChange={(event) => onGuildIdChange(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="desktop-local-channel-id">Storage channel ID</FieldLabel>
            <Input id="desktop-local-channel-id" value={channelId} inputMode="numeric" disabled={!compatible || saving} onChange={(event) => onChannelIdChange(event.target.value)} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="desktop-local-bot-tokens">Discord bot tokens{settings.botTokensConfigured ? ` (${settings.botTokenCount} configured)` : ""}</FieldLabel>
          <Input id="desktop-local-bot-tokens" type="password" value={botTokens} autoComplete="off" disabled={!compatible || saving} placeholder={settings.botTokensConfigured ? "Leave blank to keep stored tokens" : "Token, or comma-separated tokens"} onChange={(event) => onBotTokensChange(event.target.value)} />
          <FieldDescription>Each token is stored as a separate indexed OS keyring credential. Saved tokens are never returned to the UI.</FieldDescription>
        </Field>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Managed web UI</p>
            <p className="mt-1 text-sm text-muted-foreground">Optional self-contained Next.js runtime with embedded Node.js 24. It binds only to localhost and proxies browser API requests to the managed backend.</p>
          </div>
          <Switch checked={webEnabled} disabled={!compatible || saving} onCheckedChange={onWebEnabledChange} aria-label="Enable managed web UI" />
        </div>

        <div className="flex justify-end">
          <Button type="button" disabled={!compatible || saving || !guildId.trim() || !channelId.trim() || (!botTokens.trim() && !settings.botTokensConfigured)} onClick={onSave}>
            {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

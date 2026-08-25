import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Field, FieldDescription, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { FolderOpenIcon, KeyRoundIcon, LoaderCircle } from "lucide-react"

import type { LocalServerSettings } from "#lib/local-runtime"

export function LocalServerDatabase({ settings, dataDirectory, saving, onPickDataDirectory, onSave }: { settings: LocalServerSettings; dataDirectory: string; saving: boolean; onPickDataDirectory: () => void; onSave: () => void }) {
  const compatibility = settings.dataCompatibility
  return (
    <Card>
      <CardHeader>
        <CardTitle>Database</CardTitle>
        <CardDescription>Manage Local data storage and inspect compatibility metadata for this installation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!compatibility.compatible ? <p className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{compatibility.detail ?? "Update DisCloud before using this Local data directory."}</p> : null}

        <Field>
          <FieldLabel htmlFor="desktop-local-data-directory">Local data directory</FieldLabel>
          <div className="flex gap-2">
            <Input id="desktop-local-data-directory" className="min-w-0" value={dataDirectory} readOnly />
            <Button type="button" variant="outline" disabled={settings.dataDirectoryLocked || !compatibility.compatible} onClick={onPickDataDirectory}><FolderOpenIcon data-icon="inline-start" />Browse</Button>
          </div>
          <FieldDescription>{settings.dataDirectoryLocked ? "The directory is locked after PostgreSQL initialization. Data migration will require a separate flow." : `Default: ${settings.defaultDataDirectory}`}</FieldDescription>
        </Field>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <SecretState label={settings.botTokensConfigured ? `Bot tokens (${settings.botTokenCount})` : "Bot tokens"} configured={settings.botTokensConfigured} />
          <SecretState label="Encryption key" configured={settings.encryptionKeyConfigured} />
          <SecretState label="Database password" configured={settings.databasePasswordConfigured} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Metadata label="Local data schema" value={`${compatibility.schemaVersion} (supported ${compatibility.supportedSchemaMin}-${compatibility.supportedSchemaMax})`} />
          <Metadata label="Last DisCloud version" value={compatibility.lastAppVersion ? `v${compatibility.lastAppVersion}` : "Legacy data"} />
        </div>

        <div className="flex justify-end">
          <Button type="button" disabled={!compatibility.compatible || saving || dataDirectory === settings.dataDirectory} onClick={onSave}>{saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}Save data directory</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SecretState({ label, configured }: { label: string; configured: boolean }) {
  return <div className="flex items-center gap-2 rounded-lg border px-3 py-2"><KeyRoundIcon className="size-4 text-muted-foreground" /><span>{label}: {configured ? "Configured" : "Missing"}</span></div>
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>
}

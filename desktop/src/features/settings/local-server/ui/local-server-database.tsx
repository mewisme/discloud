import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Field, FieldDescription, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { DatabaseIcon, FolderOpenIcon, KeyRoundIcon, LoaderCircle, LockKeyholeIcon, ShieldCheckIcon } from "lucide-react"

import type { LocalServerSettings } from "#lib/local-runtime"

export function LocalServerDatabase({ settings, dataDirectory, saving, onPickDataDirectory, onSave }: { settings: LocalServerSettings; dataDirectory: string; saving: boolean; onPickDataDirectory: () => void; onSave: () => void }) {
  const compatibility = settings.dataCompatibility
  const directoryChanged = dataDirectory !== settings.dataDirectory

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2"><DatabaseIcon className="size-4" />Database storage</CardTitle>
            <CardDescription>Choose where Local server data lives and see whether that location can still be moved.</CardDescription>
          </div>
          <Badge variant={settings.dataDirectoryLocked ? "secondary" : "outline"}>{settings.dataDirectoryLocked ? "Location locked" : "Location movable"}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {!compatibility.compatible ? <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{compatibility.detail ?? "Update DisCloud before using this Local data directory."}</div> : null}
          <Field>
            <FieldLabel htmlFor="desktop-local-data-directory">Local data directory</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="desktop-local-data-directory" className="min-w-0 font-mono text-xs" value={dataDirectory} readOnly />
              <Button type="button" variant="outline" disabled={settings.dataDirectoryLocked || !compatibility.compatible} onClick={onPickDataDirectory}><FolderOpenIcon data-icon="inline-start" />Browse</Button>
            </div>
            <FieldDescription>{settings.dataDirectoryLocked ? "PostgreSQL has already initialized this directory. Moving an initialized database requires a dedicated migration flow." : `Default location: ${settings.defaultDataDirectory}`}</FieldDescription>
          </Field>
          <div className="flex items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-muted-foreground">{directoryChanged ? "A new location is selected but has not been saved yet." : "The saved location is active."}</p><Button type="button" disabled={!compatibility.compatible || saving || !directoryChanged} onClick={onSave}>{saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}Save location</Button></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheckIcon className="size-4" />Compatibility</CardTitle>
            <CardDescription>Metadata used to prevent unsafe database or application downgrades.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow icon={DatabaseIcon} label="Local data schema" detail={`Supported ${compatibility.supportedSchemaMin}-${compatibility.supportedSchemaMax}`} value={`${compatibility.schemaVersion}`} good={compatibility.compatible} />
            <StatusRow icon={ShieldCheckIcon} label="Compatibility" detail={compatibility.detail ?? "This data can be used by the current Desktop version."} value={compatibility.compatible ? "Compatible" : "Blocked"} good={compatibility.compatible} />
            <StatusRow icon={LockKeyholeIcon} label="Last DisCloud version" detail="Last Desktop version that successfully activated this data directory." value={compatibility.lastAppVersion ? `v${compatibility.lastAppVersion}` : "Legacy data"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><KeyRoundIcon className="size-4" />Database security</CardTitle>
            <CardDescription>Required secrets used by the managed database and encrypted application data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SecretRow label="Database password" configured={settings.databasePasswordConfigured} description="Authenticates the local backend to managed PostgreSQL." />
            <SecretRow label="Encryption key" configured={settings.encryptionKeyConfigured} description="Protects encrypted values persisted by the backend." />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatusRow({ icon: Icon, label, detail, value, good }: { icon: typeof DatabaseIcon; label: string; detail: string; value: string; good?: boolean }) {
  return <div className="flex items-start gap-3 rounded-lg border p-3"><div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{label}</p><Badge variant={good === false ? "destructive" : "secondary"}>{value}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></div>
}

function SecretRow({ label, configured, description }: { label: string; configured: boolean; description: string }) {
  return <div className="flex items-start gap-3 rounded-lg border p-3"><div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><KeyRoundIcon className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{label}</p><Badge variant={configured ? "default" : "destructive"}>{configured ? "Configured" : "Missing"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{description}</p></div></div>
}
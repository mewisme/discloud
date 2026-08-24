import type { ChangePasswordInput, MFACodeInput,MFAEnrollment } from "@discloud/api/models"
import { APIError } from "@discloud/api/types"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { CopyButton } from "@discloud/ui/components/copy-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Input } from "@discloud/ui/components/input"
import { save } from "@tauri-apps/plugin-dialog"
import { CheckIcon, DownloadIcon, KeyRoundIcon, Loader2Icon, RefreshCwIcon, ShieldCheckIcon, ShieldOffIcon, TriangleAlertIcon } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { type FormEvent, useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"

import { saveRecoveryCodes } from "../core/profile"
import { beginMFAEnrollment, confirmMFAEnrollment, disableMFA, loadMFAStatus, regenerateRecoveryCodes, updatePassword } from "../core/security"

type MFAAction = "regenerate" | "disable"

export function DesktopSecuritySettingsPage() {
  const [enabled, setEnabled] = useState<boolean>()
  const [loading, setLoading] = useState(true)
  const [enrollment, setEnrollment] = useState<MFAEnrollment>()
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>()
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(undefined)

      try {
        const status = await loadMFAStatus()
        if (!cancelled) setEnabled(status.enabled)
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [version])

  if (loading && enabled === undefined) {
    return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" />Loading security settings</div></div>
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">Manage your password, two-factor authentication and recovery codes.</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Security action failed</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error}</p>
            {enabled === undefined ? <Button size="sm" variant="outline" onClick={() => setVersion((value) => value + 1)}>Try again</Button> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {recoveryCodes ? <RecoveryCodes codes={recoveryCodes} onDismiss={() => setRecoveryCodes(undefined)} onError={setError} /> : null}
      <PasswordCard onError={setError} />

      {enabled !== undefined ? (
        <MFACard
          enabled={enabled}
          enrollment={enrollment}
          onEnrollment={setEnrollment}
          onEnabled={setEnabled}
          onRecoveryCodes={setRecoveryCodes}
          onError={setError}
        />
      ) : null}
    </div>
  )
}

function PasswordCard({ onError }: { onError: (message?: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    onError(undefined)
    setSaved(false)

    if (!currentPassword) {
      onError("Current password is required.")
      return
    }

    if (Array.from(newPassword).length < 12) {
      onError("New password must be at least 12 characters.")
      return
    }

    if (newPassword !== confirmPassword) {
      onError("Passwords do not match.")
      return
    }

    setPending(true)

    try {
      const input = { currentPassword, newPassword } satisfies ChangePasswordInput
      await updatePassword(input)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setSaved(true)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRoundIcon className="size-4" />Password</CardTitle>
        <CardDescription>Change the password used to sign in to this DisCloud server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <PasswordField id="security-current-password" label="Current password" value={currentPassword} autoComplete="current-password" disabled={pending} onChange={setCurrentPassword} />
          <PasswordField id="security-new-password" label="New password" value={newPassword} autoComplete="new-password" disabled={pending} description="Use at least 12 characters." onChange={setNewPassword} />
          <PasswordField id="security-confirm-password" label="Confirm new password" value={confirmPassword} autoComplete="new-password" disabled={pending} onChange={setConfirmPassword} />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
              {pending ? "Changing..." : "Change password"}
            </Button>
            {saved ? <span className="text-sm text-muted-foreground">Password updated.</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function MFACard({ enabled, enrollment, onEnrollment, onEnabled, onRecoveryCodes, onError }: {
  enabled: boolean
  enrollment?: MFAEnrollment
  onEnrollment: (enrollment?: MFAEnrollment) => void
  onEnabled: (enabled: boolean) => void
  onRecoveryCodes: (codes?: readonly string[]) => void
  onError: (message?: string) => void
}) {
  const [starting, setStarting] = useState(false)
  const [confirmCode, setConfirmCode] = useState("")
  const [action, setAction] = useState<MFAAction>()
  const [actionCode, setActionCode] = useState("")
  const [pending, setPending] = useState(false)

  async function startEnrollment() {
    setStarting(true)
    onError(undefined)
    onRecoveryCodes(undefined)

    try {
      onEnrollment(await beginMFAEnrollment())
      setConfirmCode("")
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 409) {
        onEnabled(true)
        onEnrollment(undefined)
      } else {
        onError(errorMessage(cause))
      }
    } finally {
      setStarting(false)
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()

    if (!/^\d{6}$/.test(confirmCode.trim())) {
      onError("Enter the 6-digit authentication code.")
      return
    }

    setPending(true)
    onError(undefined)

    try {
      const input = { code: confirmCode.trim() } satisfies MFACodeInput
      const result = await confirmMFAEnrollment(input)
      onEnabled(true)
      onEnrollment(undefined)
      onRecoveryCodes(result.recoveryCodes)
      setConfirmCode("")
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 409) onEnrollment(undefined)
      onError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault()
    if (!action || !actionCode.trim()) return

    setPending(true)
    onError(undefined)

    try {
      const input = { code: actionCode.trim() } satisfies MFACodeInput

      if (action === "regenerate") {
        const result = await regenerateRecoveryCodes(input)
        onRecoveryCodes(result.recoveryCodes)
      } else {
        await disableMFA(input)
        onEnabled(false)
        onRecoveryCodes(undefined)
      }

      setAction(undefined)
      setActionCode("")
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 409) {
        onEnabled(false)
        setAction(undefined)
        setActionCode("")
      } else {
        onError(errorMessage(cause))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheckIcon className="size-4" />Two-factor authentication</CardTitle>
            <CardDescription>Add an authenticator code after your password when signing in.</CardDescription>
          </div>
          <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!enabled && !enrollment ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Protect your account with a time-based one-time password authenticator.</p>
            <Button disabled={starting} onClick={() => void startEnrollment()}>
              {starting ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
              {starting ? "Starting setup..." : "Set up two-factor authentication"}
            </Button>
          </div>
        ) : null}

        {!enabled && enrollment ? (
          <form className="space-y-5" onSubmit={confirm}>
            <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="w-fit rounded-xl border bg-white p-3">
                <QRCodeSVG value={enrollment.provisioningUri} size={176} level="M" />
              </div>
              <div className="space-y-2 text-sm">
                <p className="font-medium">Scan this QR code with your authenticator app.</p>
                <p className="text-muted-foreground">Setup expires {formatDate(enrollment.expiresAt)}.</p>
                {provisioningSecret(enrollment.provisioningUri) ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Manual setup key</p>
                    <code className="block break-all rounded-lg bg-muted px-2.5 py-2 text-xs">{provisioningSecret(enrollment.provisioningUri)}</code>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="mfa-confirm-code" className="text-sm font-medium">Authentication code</label>
              <Input id="mfa-confirm-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={confirmCode} disabled={pending} className="max-w-48 font-mono tracking-[0.35em]" onChange={(event) => setConfirmCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
              <p className="text-sm text-muted-foreground">Enter the 6-digit code generated by your authenticator.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" /> : null}{pending ? "Verifying..." : "Enable MFA"}</Button>
              <Button type="button" variant="outline" disabled={starting || pending} onClick={() => void startEnrollment()}>{starting ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}Start over</Button>
            </div>
          </form>
        ) : null}

        {enabled && !action ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Your account requires an authenticator or recovery code after password authentication.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { setAction("regenerate"); setActionCode(""); onError(undefined) }}><RefreshCwIcon />Regenerate recovery codes</Button>
              <Button variant="destructive" onClick={() => { setAction("disable"); setActionCode(""); onError(undefined) }}><ShieldOffIcon />Disable MFA</Button>
            </div>
          </div>
        ) : null}

        {enabled && action ? (
          <form className="space-y-4" onSubmit={submitAction}>
            <div>
              <p className="font-medium">{action === "disable" ? "Disable two-factor authentication" : "Regenerate recovery codes"}</p>
              <p className="mt-1 text-sm text-muted-foreground">Enter a current authenticator code or one unused recovery code to continue.</p>
            </div>
            <Input autoFocus autoComplete="one-time-code" value={actionCode} disabled={pending} placeholder="Authentication or recovery code" onChange={(event) => setActionCode(event.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" variant={action === "disable" ? "destructive" : "default"} disabled={pending || !actionCode.trim()}>{pending ? <Loader2Icon className="animate-spin" /> : null}{action === "disable" ? "Disable MFA" : "Regenerate codes"}</Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => { setAction(undefined); setActionCode("") }}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RecoveryCodes({ codes, onDismiss, onError }: { codes: readonly string[]; onDismiss: () => void; onError: (message?: string) => void }) {
  const [saving, setSaving] = useState(false)

  async function download() {
    setSaving(true)
    onError(undefined)

    try {
      const destination = await save({ title: "Save recovery codes", defaultPath: "discloud-recovery-codes.txt", filters: [{ name: "Text", extensions: ["txt"] }] })
      if (destination) await saveRecoveryCodes(destination, codes)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Alert>
      <KeyRoundIcon />
      <AlertTitle>Save your recovery codes now</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>Each code can be used once. DisCloud will not show this set again after you dismiss it.</p>
        <div className="grid gap-1 rounded-lg border bg-muted/50 p-3 font-mono text-xs sm:grid-cols-2">{codes.map((code) => <code key={code}>{code}</code>)}</div>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={codes.join("\n")} label="Copy recovery codes" type="button" size="sm" variant="outline" onCopyError={(cause) => onError(errorMessage(cause))}>Copy</CopyButton>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void download()}>{saving ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}{saving ? "Saving..." : "Download"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}><CheckIcon />I saved them</Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function PasswordField({ id, label, value, autoComplete, disabled, description, onChange }: { id: string; label: string; value: string; autoComplete: string; disabled: boolean; description?: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input id={id} type="password" autoComplete={autoComplete} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  )
}

function provisioningSecret(uri: string) {
  try {
    return new URL(uri).searchParams.get("secret") ?? ""
  } catch {
    return ""
  }
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  } catch {
    return value
  }
}

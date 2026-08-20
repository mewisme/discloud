"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { CheckIcon, ClipboardIcon, DownloadIcon, KeyRoundIcon, Loader2Icon, RefreshCwIcon, ShieldCheckIcon, ShieldOffIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { DateTime } from "@/components/common/date-time"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { apiJSON } from "@/lib/api/client"
import type { MFACodeInput, MFAEnrollment, RecoveryCodes } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { type APIFormError,apiFormError } from "@/lib/helpers"

const totpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit authentication code"),
})

const verificationSchema = z.object({
  code: z.string().trim().min(1, "Authentication or recovery code is required"),
})

type TOTPValues = z.infer<typeof totpSchema>
type VerificationValues = z.infer<typeof verificationSchema>
type MFAAction = "regenerate" | "disable"

export function SecuritySettings({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [enrollment, setEnrollment] = useState<MFAEnrollment>()
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>()
  const [action, setAction] = useState<MFAAction>()
  const [starting, setStarting] = useState(false)
  const [formError, setFormError] = useState<APIFormError>()
  const confirmForm = useForm<TOTPValues>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: "" },
  })
  const actionForm = useForm<VerificationValues>({
    resolver: zodResolver(verificationSchema),
    defaultValues: { code: "" },
  })

  async function startEnrollment() {
    setStarting(true)
    setFormError(undefined)
    setRecoveryCodes(undefined)

    try {
      const result = await apiJSON<MFAEnrollment>("/api/v1/me/mfa/totp/enroll", { method: "POST" })
      setEnrollment(result)
      confirmForm.reset()
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        setEnabled(true)
        setEnrollment(undefined)
        toast.info("Two-factor authentication is already enabled")
      } else {
        setFormError(apiFormError(error, "Could not start two-factor authentication setup."))
      }
    } finally {
      setStarting(false)
    }
  }

  async function confirmEnrollment(values: TOTPValues) {
    setFormError(undefined)

    try {
      const input: MFACodeInput = { code: values.code }
      const result = await apiJSON<RecoveryCodes>("/api/v1/me/mfa/totp/confirm", { method: "POST", body: input })
      setEnabled(true)
      setEnrollment(undefined)
      setRecoveryCodes(result.recoveryCodes)
      confirmForm.reset()
      toast.success("Two-factor authentication enabled")
    } catch (error) {
      if (error instanceof APIError && error.status === 400) {
        confirmForm.setError("code", { message: error.message }, { shouldFocus: true })
        return
      }

      if (error instanceof APIError && error.status === 409) {
        if (error.message.toLowerCase().includes("already enabled")) {
          setEnabled(true)
          setEnrollment(undefined)
          toast.info("Two-factor authentication is already enabled")
          return
        }

        setEnrollment(undefined)
        setFormError({ message: "The enrollment expired. Start setup again.", requestID: error.requestID })
        return
      }

      setFormError(apiFormError(error, "Could not confirm two-factor authentication."))
    }
  }

  async function submitAction(values: VerificationValues) {
    if (!action) return
    setFormError(undefined)

    try {
      const input: MFACodeInput = { code: values.code }

      if (action === "regenerate") {
        const result = await apiJSON<RecoveryCodes>("/api/v1/me/mfa/recovery-codes/regenerate", { method: "POST", body: input })
        setRecoveryCodes(result.recoveryCodes)
        toast.success("Recovery codes regenerated")
      } else {
        await apiJSON<void>("/api/v1/me/mfa/totp", { method: "DELETE", body: input })
        setEnabled(false)
        setRecoveryCodes(undefined)
        toast.success("Two-factor authentication disabled")
      }

      closeAction()
    } catch (error) {
      if (error instanceof APIError && error.status === 400) {
        actionForm.setError("code", { message: error.message }, { shouldFocus: true })
        return
      }

      if (error instanceof APIError && error.status === 409) {
        setEnabled(false)
        closeAction()
        toast.info("Two-factor authentication is not enabled")
        return
      }

      setFormError(apiFormError(error, action === "disable" ? "Could not disable two-factor authentication." : "Could not regenerate recovery codes."))
    }
  }

  function openAction(next: MFAAction) {
    setAction(next)
    setFormError(undefined)
    actionForm.reset()
  }

  function closeAction() {
    setAction(undefined)
    actionForm.reset()
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes?.length) return

    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"))
      toast.success("Recovery codes copied")
    } catch {
      toast.error("Could not copy recovery codes")
    }
  }

  function downloadRecoveryCodes() {
    if (!recoveryCodes?.length) return

    const blob = new Blob([`DisCloud recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "discloud-recovery-codes.txt"
    link.click()
    URL.revokeObjectURL(url)
  }

  const secret = enrollment ? provisioningSecret(enrollment.provisioningUri) : ""
  const confirmState = confirmForm.formState
  const actionState = actionForm.formState

  return (
    <div className="space-y-4">
      {formError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Security action failed</AlertTitle>
          <AlertDescription>
            {formError.message}
            {formError.requestID && <p className="mt-1 font-mono text-xs">Request ID: {formError.requestID}</p>}
          </AlertDescription>
        </Alert>
      )}

      {recoveryCodes && (
        <Alert>
          <KeyRoundIcon />
          <AlertTitle>Save your recovery codes now</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Each code can be used once. DisCloud will not show this set again after you dismiss it.</p>
            <div className="grid gap-1 rounded-lg border bg-muted/50 p-3 font-mono text-xs sm:grid-cols-2">
              {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={copyRecoveryCodes}>
                <ClipboardIcon />
                Copy
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={downloadRecoveryCodes}>
                <DownloadIcon />
                Download
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRecoveryCodes(undefined)}>
                <CheckIcon />
                I saved them
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheckIcon className="size-4" />
                Two-factor authentication
              </CardTitle>
              <CardDescription>Add an authenticator code after your password when signing in.</CardDescription>
            </div>
            <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enabled && !enrollment && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Protect your account with a time-based one-time password authenticator.</p>
              <Button disabled={starting} onClick={startEnrollment}>
                {starting ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
                {starting ? "Starting setup…" : "Set up two-factor authentication"}
              </Button>
            </div>
          )}

          {!enabled && enrollment && (
            <form className="space-y-5" onSubmit={confirmForm.handleSubmit(confirmEnrollment)}>
              <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
                <div className="w-fit rounded-xl border bg-white p-3">
                  <QRCodeSVG value={enrollment.provisioningUri} size={176} level="M" />
                </div>
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Scan this QR code with your authenticator app.</p>
                  <p className="text-muted-foreground">Setup expires <DateTime value={enrollment.expiresAt} /></p>
                  {secret && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Manual setup key</p>
                      <code className="block break-all rounded-lg bg-muted px-2.5 py-2 text-xs">{secret}</code>
                    </div>
                  )}
                </div>
              </div>

              <Field data-invalid={!!confirmState.errors.code}>
                <FieldLabel>Authentication code</FieldLabel>
                <Controller
                  control={confirmForm.control}
                  name="code"
                  render={({ field }) => (
                    <InputOTP maxLength={6} inputMode="numeric" autoComplete="one-time-code" autoFocus disabled={confirmState.isSubmitting} aria-invalid={!!confirmState.errors.code} value={field.value} onChange={field.onChange}>
                      <InputOTPGroup>
                        {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}
                      </InputOTPGroup>
                    </InputOTP>
                  )}
                />
                <FieldDescription>Enter the 6-digit code generated by your authenticator.</FieldDescription>
                <FieldError errors={[confirmState.errors.code]} />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={confirmState.isSubmitting}>
                  {confirmState.isSubmitting && <Loader2Icon className="animate-spin" />}
                  {confirmState.isSubmitting ? "Verifying…" : "Enable MFA"}
                </Button>
                <Button type="button" variant="outline" disabled={starting || confirmState.isSubmitting} onClick={startEnrollment}>
                  {starting ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                  Start over
                </Button>
              </div>
            </form>
          )}

          {enabled && !action && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Your account requires an authenticator or recovery code after password authentication.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => openAction("regenerate")}>
                  <RefreshCwIcon />
                  Regenerate recovery codes
                </Button>
                <Button variant="destructive" onClick={() => openAction("disable")}>
                  <ShieldOffIcon />
                  Disable MFA
                </Button>
              </div>
            </div>
          )}

          {enabled && action && (
            <form onSubmit={actionForm.handleSubmit(submitAction)}>
              <FieldGroup>
                <Alert variant={action === "disable" ? "destructive" : "default"}>
                  {action === "disable" ? <ShieldOffIcon /> : <RefreshCwIcon />}
                  <AlertTitle>{action === "disable" ? "Disable two-factor authentication" : "Generate new recovery codes"}</AlertTitle>
                  <AlertDescription>
                    {action === "disable"
                      ? "This removes your authenticator and all recovery codes. Other active sessions will be revoked."
                      : "Generating a new set invalidates every existing recovery code."}
                  </AlertDescription>
                </Alert>

                <Field data-invalid={!!actionState.errors.code}>
                  <FieldLabel htmlFor="verification-code">Authenticator or recovery code</FieldLabel>
                  <Input id="verification-code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} autoFocus disabled={actionState.isSubmitting} aria-invalid={!!actionState.errors.code} {...actionForm.register("code")} />
                  <FieldError errors={[actionState.errors.code]} />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant={action === "disable" ? "destructive" : "default"} disabled={actionState.isSubmitting}>
                    {actionState.isSubmitting && <Loader2Icon className="animate-spin" />}
                    {actionState.isSubmitting ? "Verifying…" : action === "disable" ? "Disable MFA" : "Generate codes"}
                  </Button>
                  <Button type="button" variant="outline" disabled={actionState.isSubmitting} onClick={closeAction}>
                    <XIcon />
                    Cancel
                  </Button>
                </div>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
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
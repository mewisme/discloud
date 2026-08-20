"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon, RefreshCwIcon, ShieldCheckIcon, ShieldOffIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { MFAEnrollment } from "@/components/settings/security/mfa-enrollment"
import { type MFAAction, MFAVerificationAction } from "@/components/settings/security/mfa-verification-action"
import { RecoveryCodes } from "@/components/settings/security/recovery-codes"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiJSON } from "@/lib/api/client"
import type { MFACodeInput, MFAEnrollment as MFAEnrollmentModel, RecoveryCodes as RecoveryCodesModel } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { type APIFormError, apiFormError } from "@/lib/helpers"

const totpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit authentication code"),
})

const verificationSchema = z.object({
  code: z.string().trim().min(1, "Authentication or recovery code is required"),
})

type TOTPValues = z.infer<typeof totpSchema>
type VerificationValues = z.infer<typeof verificationSchema>

export function SecuritySettings({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [enrollment, setEnrollment] = useState<MFAEnrollmentModel>()
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
      const result = await apiJSON<MFAEnrollmentModel>("/api/v1/me/mfa/totp/enroll", { method: "POST" })
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
      const result = await apiJSON<RecoveryCodesModel>("/api/v1/me/mfa/totp/confirm", {
        method: "POST",
        body: input,
      })

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
        setFormError({
          message: "The enrollment expired. Start setup again.",
          requestID: error.requestID,
        })
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
        const result = await apiJSON<RecoveryCodesModel>("/api/v1/me/mfa/recovery-codes/regenerate", {
          method: "POST",
          body: input,
        })
        setRecoveryCodes(result.recoveryCodes)
        toast.success("Recovery codes regenerated")
      } else {
        await apiJSON<void>("/api/v1/me/mfa/totp", {
          method: "DELETE",
          body: input,
        })
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

      setFormError(apiFormError(
        error,
        action === "disable"
          ? "Could not disable two-factor authentication."
          : "Could not regenerate recovery codes.",
      ))
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

    const blob = new Blob(
      [`DisCloud recovery codes\n\n${recoveryCodes.join("\n")}\n`],
      { type: "text/plain;charset=utf-8" },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "discloud-recovery-codes.txt"
    link.click()
    URL.revokeObjectURL(url)
  }

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
        <RecoveryCodes
          codes={recoveryCodes}
          onCopy={() => void copyRecoveryCodes()}
          onDownload={downloadRecoveryCodes}
          onDismiss={() => setRecoveryCodes(undefined)}
        />
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

            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!enabled && !enrollment && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Protect your account with a time-based one-time password authenticator.
              </p>

              <Button disabled={starting} onClick={() => void startEnrollment()}>
                {starting ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
                {starting ? "Starting setup…" : "Set up two-factor authentication"}
              </Button>
            </div>
          )}

          {!enabled && enrollment && (
            <MFAEnrollment
              enrollment={enrollment}
              form={confirmForm}
              starting={starting}
              onConfirm={confirmEnrollment}
              onStartOver={startEnrollment}
            />
          )}

          {enabled && !action && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your account requires an authenticator or recovery code after password authentication.
              </p>

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
            <MFAVerificationAction
              action={action}
              form={actionForm}
              onSubmit={submitAction}
              onCancel={closeAction}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
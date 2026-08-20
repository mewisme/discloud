"use client"

import { Loader2Icon, RefreshCwIcon, ShieldOffIcon, XIcon } from "lucide-react"
import type { UseFormReturn } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type MFAAction = "regenerate" | "disable"
type VerificationValues = { code: string }

export function MFAVerificationAction({
  action,
  form,
  onSubmit,
  onCancel,
}: {
  action: MFAAction
  form: UseFormReturn<VerificationValues>
  onSubmit: (values: VerificationValues) => Promise<void>
  onCancel: () => void
}) {
  const state = form.formState

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
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

        <Field data-invalid={!!state.errors.code}>
          <FieldLabel htmlFor="verification-code">Authenticator or recovery code</FieldLabel>
          <Input
            id="verification-code"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            disabled={state.isSubmitting}
            aria-invalid={!!state.errors.code}
            {...form.register("code")}
          />
          <FieldError errors={[state.errors.code]} />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={action === "disable" ? "destructive" : "default"} disabled={state.isSubmitting}>
            {state.isSubmitting && <Loader2Icon className="animate-spin" />}
            {state.isSubmitting ? "Verifying…" : action === "disable" ? "Disable MFA" : "Generate codes"}
          </Button>

          <Button type="button" variant="outline" disabled={state.isSubmitting} onClick={onCancel}>
            <XIcon />
            Cancel
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
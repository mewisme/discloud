"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { apiJSON } from "@/lib/api/client"
import type { ChangePasswordInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { type APIFormError, apiFormError } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().refine((value) => Array.from(value).length >= 12, "Password must be at least 12 characters"),
  confirmPassword: z.string(),
}).refine((value) => value.newPassword === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
})

type PasswordValues = z.infer<typeof passwordSchema>

export function ChangePasswordForm({ username }: { username: string }) {
  const router = useRouter()
  const [formError, setFormError] = useState<APIFormError>()
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  })

  async function onSubmit(values: PasswordValues) {
    setFormError(undefined)

    try {
      const input: ChangePasswordInput = {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }

      await apiJSON<void>("/api/v1/me/password", {
        method: "PUT",
        body: input,
      })

      toast.success("Password changed")
      router.replace(workspacePath(username))
      router.refresh()
    } catch (error) {
      handleError(error)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof APIError)) {
      setFormError(apiFormError(error, "Could not change password. Try again."))
      return
    }

    const message = error.message.toLowerCase()

    if (error.status === 400 && message.includes("current password")) {
      form.setError("currentPassword", { message: error.message }, { shouldFocus: true })
      return
    }

    if (error.status === 400 && message.includes("12 characters")) {
      form.setError("newPassword", { message: error.message }, { shouldFocus: true })
      return
    }

    setFormError(apiFormError(error, "Could not change password."))
  }

  const { errors, isSubmitting } = form.formState

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change your password</CardTitle>
        <CardDescription>You must choose a new password before continuing.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {formError && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Password change failed</AlertTitle>
                <AlertDescription>
                  {formError.message}
                  {formError.requestID && <p className="mt-1 font-mono text-xs">Request ID: {formError.requestID}</p>}
                </AlertDescription>
              </Alert>
            )}

            <Field data-invalid={!!errors.currentPassword}>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <PasswordInput id="current-password" autoComplete="current-password" autoFocus disabled={isSubmitting} aria-invalid={!!errors.currentPassword} {...form.register("currentPassword")} />
              <FieldError errors={[errors.currentPassword]} />
            </Field>

            <Field data-invalid={!!errors.newPassword}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput id="new-password" autoComplete="new-password" disabled={isSubmitting} aria-invalid={!!errors.newPassword} {...form.register("newPassword")} />
              <FieldDescription>Use at least 12 characters.</FieldDescription>
              <FieldError errors={[errors.newPassword]} />
            </Field>

            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
              <PasswordInput id="confirm-password" autoComplete="new-password" disabled={isSubmitting} aria-invalid={!!errors.confirmPassword} {...form.register("confirmPassword")} />
              <FieldError errors={[errors.confirmPassword]} />
            </Field>

            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="animate-spin" />}
              {isSubmitting ? "Changing password…" : "Change password"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
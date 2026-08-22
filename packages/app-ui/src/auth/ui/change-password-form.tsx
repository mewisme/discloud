"use client"

import { apiFormError, type APIFormError } from "@discloud/api/errors"
import type { ChangePasswordInput } from "@discloud/api/models"
import { APIError } from "@discloud/api/types"
import { Button } from "@discloud/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@discloud/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@discloud/ui/components/field"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { AuthFormAlert } from "./form-alert"
import { PasswordInput } from "./password-input"

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .refine(
      (value) => Array.from(value).length >= 12,
      "Password must be at least 12 characters",
    ),
  confirmPassword: z.string(),
}).refine((value) => value.newPassword === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
})

type PasswordValues = z.infer<typeof passwordSchema>

export function ChangePasswordForm({
  changePassword,
  onChanged,
}: {
  changePassword: (input: ChangePasswordInput) => Promise<void>
  onChanged: () => void | Promise<void>
}) {
  const [formError, setFormError] = useState<APIFormError>()
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  async function onSubmit(values: PasswordValues) {
    setFormError(undefined)

    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })

      await onChanged()
    } catch (error) {
      handleError(error)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof APIError)) {
      setFormError(
        apiFormError(error, "Could not change password. Try again."),
      )
      return
    }

    const message = error.message.toLowerCase()

    if (error.status === 400 && message.includes("current password")) {
      form.setError(
        "currentPassword",
        { message: error.message },
        { shouldFocus: true },
      )
      return
    }

    if (error.status === 400 && message.includes("12 characters")) {
      form.setError(
        "newPassword",
        { message: error.message },
        { shouldFocus: true },
      )
      return
    }

    setFormError(apiFormError(error, "Could not change password."))
  }

  const { errors, isSubmitting } = form.formState

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change your password</CardTitle>
        <CardDescription>
          You must choose a new password before continuing.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {formError ? (
              <AuthFormAlert
                error={formError}
                title="Password change failed"
              />
            ) : null}

            <Field data-invalid={!!errors.currentPassword}>
              <FieldLabel htmlFor="current-password">
                Current password
              </FieldLabel>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                autoFocus
                disabled={isSubmitting}
                aria-invalid={!!errors.currentPassword}
                {...form.register("currentPassword")}
              />
              <FieldError errors={[errors.currentPassword]} />
            </Field>

            <Field data-invalid={!!errors.newPassword}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                disabled={isSubmitting}
                aria-invalid={!!errors.newPassword}
                {...form.register("newPassword")}
              />
              <FieldDescription>Use at least 12 characters.</FieldDescription>
              <FieldError errors={[errors.newPassword]} />
            </Field>

            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirm-password">
                Confirm new password
              </FieldLabel>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                disabled={isSubmitting}
                aria-invalid={!!errors.confirmPassword}
                {...form.register("confirmPassword")}
              />
              <FieldError errors={[errors.confirmPassword]} />
            </Field>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              {isSubmitting ? "Changing password…" : "Change password"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
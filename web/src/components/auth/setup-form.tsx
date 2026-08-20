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
import { Input } from "@/components/ui/input"
import { apiJSON } from "@/lib/api/client"
import type { SetupInput, SetupResult } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { type APIFormError, apiFormError } from "@/lib/helpers"

const setupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be at most 100 characters"),
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().refine((value) => Array.from(value).length >= 12, "Password must be at least 12 characters"),
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
})

type SetupFormValues = z.infer<typeof setupSchema>

export function SetupForm() {
  const router = useRouter()
  const [formError, setFormError] = useState<APIFormError>()
  const form = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { name: "", username: "", password: "", confirmPassword: "" },
  })

  async function onSubmit(values: SetupFormValues) {
    setFormError(undefined)

    try {
      const input: SetupInput = { name: values.name, username: values.username, password: values.password }
      await apiJSON<SetupResult>("/api/v1/setup", { method: "POST", body: input })
      toast.success("Administrator created")
      router.replace("/login")
      router.refresh()
    } catch (error) {
      handleSubmitError(error)
    }
  }

  function handleSubmitError(error: unknown) {
    if (!(error instanceof APIError)) {
      setFormError(apiFormError(error, "Could not connect to DisCloud. Try again."))
      return
    }

    if (error.status === 409) {
      toast.info("Setup was already completed")
      router.replace("/login")
      router.refresh()
      return
    }

    const message = error.message.toLowerCase()

    if (error.status === 400 && message.includes("username")) {
      form.setError("username", { message: error.message }, { shouldFocus: true })
      return
    }

    if (error.status === 400 && message.includes("name")) {
      form.setError("name", { message: error.message }, { shouldFocus: true })
      return
    }

    if (error.status === 400 && message.includes("password")) {
      form.setError("password", { message: error.message }, { shouldFocus: true })
      return
    }

    setFormError(apiFormError(error, "Could not complete setup."))
  }

  const { errors, isSubmitting } = form.formState

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create administrator</CardTitle>
        <CardDescription>Create the first account for this DisCloud instance.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {formError && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Setup failed</AlertTitle>
                <AlertDescription>
                  {formError.message}
                  {formError.requestID && <p className="mt-1 font-mono text-xs">Request ID: {formError.requestID}</p>}
                </AlertDescription>
              </Alert>
            )}

            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" autoComplete="name" autoFocus disabled={isSubmitting} aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldDescription>Your display name. You can change this later.</FieldDescription>
              <FieldError errors={[errors.name]} />
            </Field>

            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input id="username" autoComplete="username" disabled={isSubmitting} aria-invalid={!!errors.username} {...form.register("username")} />
              <FieldDescription>Used to sign in and in workspace URLs. Username cannot be changed later.</FieldDescription>
              <FieldError errors={[errors.username]} />
            </Field>

            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <PasswordInput id="password" autoComplete="new-password" disabled={isSubmitting} aria-invalid={!!errors.password} {...form.register("password")} />
              <FieldDescription>Use at least 12 characters.</FieldDescription>
              <FieldError errors={[errors.password]} />
            </Field>

            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
              <PasswordInput id="confirm-password" autoComplete="new-password" disabled={isSubmitting} aria-invalid={!!errors.confirmPassword} {...form.register("confirmPassword")} />
              <FieldError errors={[errors.confirmPassword]} />
            </Field>

            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="animate-spin" />}
              {isSubmitting ? "Creating administrator…" : "Create administrator"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
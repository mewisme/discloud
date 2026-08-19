"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { EyeIcon, EyeOffIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { apiJSON } from "@/lib/api/client"
import type { SetupInput, SetupResult } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"

const setupSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().refine((value) => Array.from(value).length >= 12, "Password must be at least 12 characters"),
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
})

type SetupFormValues = z.infer<typeof setupSchema>
type FormError = { message: string; requestID?: string }

export function SetupForm() {
  const router = useRouter()
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [formError, setFormError] = useState<FormError>()
  const form = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { username: "", password: "", confirmPassword: "" },
  })

  async function onSubmit(values: SetupFormValues) {
    setFormError(undefined)

    try {
      const input: SetupInput = { username: values.username, password: values.password }
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
      setFormError({ message: "Could not connect to DisCloud. Try again." })
      return
    }

    if (error.status === 409) {
      toast.info("Setup was already completed")
      router.replace("/login")
      router.refresh()
      return
    }

    if (error.status === 400 && error.message.toLowerCase().includes("username")) {
      form.setError("username", { message: error.message }, { shouldFocus: true })
      return
    }

    if (error.status === 400 && error.message.toLowerCase().includes("password")) {
      form.setError("password", { message: error.message }, { shouldFocus: true })
      return
    }

    setFormError({ message: error.message || "Could not complete setup.", requestID: error.requestID })
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

            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                disabled={isSubmitting}
                aria-invalid={!!errors.username}
                {...form.register("username")}
              />
              <FieldError errors={[errors.username]} />
            </Field>

            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  aria-invalid={!!errors.password}
                  {...form.register("password")}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    disabled={isSubmitting}
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>Use at least 12 characters.</FieldDescription>
              <FieldError errors={[errors.password]} />
            </Field>

            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="confirm-password"
                  type={confirmVisible ? "text" : "password"}
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  aria-invalid={!!errors.confirmPassword}
                  {...form.register("confirmPassword")}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    disabled={isSubmitting}
                    aria-label={confirmVisible ? "Hide password" : "Show password"}
                    onClick={() => setConfirmVisible((visible) => !visible)}
                  >
                    {confirmVisible ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
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
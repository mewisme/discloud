"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeftIcon, Loader2Icon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react"
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
import type { LoginInput, LoginResult, MFAChallenge, User, VerifyLoginMFAInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { apiFormError, type APIFormError } from "@/lib/helpers"

const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
})

const mfaSchema = z.object({
  code: z.string().trim().min(1, "Authentication code is required"),
})

type LoginValues = z.infer<typeof loginSchema>
type MFAValues = z.infer<typeof mfaSchema>

export function LoginForm() {
  const router = useRouter()
  const [challenge, setChallenge] = useState<MFAChallenge>()
  const [formError, setFormError] = useState<APIFormError>()
  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  })
  const mfaForm = useForm<MFAValues>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: "" },
  })

  async function login(values: LoginValues) {
    setFormError(undefined)

    try {
      const input: LoginInput = values
      const result = await apiJSON<LoginResult>("/api/v1/auth/login", { method: "POST", body: input })

      if (isMFAChallenge(result)) {
        setChallenge(result)
        mfaForm.reset()
        return
      }

      completeLogin(result)
    } catch (error) {
      handleLoginError(error)
    }
  }

  async function verifyMFA(values: MFAValues) {
    if (!challenge) return
    setFormError(undefined)

    try {
      const input: VerifyLoginMFAInput = { challengeToken: challenge.challengeToken, code: values.code }
      const user = await apiJSON<User>("/api/v1/auth/mfa/verify", { method: "POST", body: input })
      completeLogin(user)
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        mfaForm.setError("code", { message: "Invalid or expired authentication code" }, { shouldFocus: true })
        return
      }
      setFormError(apiFormError(error, "Could not verify authentication code."))
    }
  }

  function completeLogin(user: User) {
    toast.success("Signed in")
    router.replace(user.mustChangePassword ? "/change-password" : "/files")
    router.refresh()
  }

  function handleLoginError(error: unknown) {
    if (error instanceof APIError && error.status === 401) {
      setFormError({ message: "Invalid username or password." })
      return
    }
    setFormError(apiFormError(error, "Could not sign in."))
  }

  function backToLogin() {
    setChallenge(undefined)
    setFormError(undefined)
    mfaForm.reset()
    loginForm.setFocus("username")
  }

  if (challenge) {
    const { errors, isSubmitting } = mfaForm.formState

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" />
            Two-factor authentication
          </CardTitle>
          <CardDescription>Enter your authenticator code or an unused recovery code.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={mfaForm.handleSubmit(verifyMFA)}>
            <FieldGroup>
              {formError && <FormAlert error={formError} />}
              <Field data-invalid={!!errors.code}>
                <FieldLabel htmlFor="mfa-code">Authentication code</FieldLabel>
                <Input id="mfa-code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} autoFocus disabled={isSubmitting} aria-invalid={!!errors.code} {...mfaForm.register("code")} />
                <FieldDescription>Authenticator and recovery codes are both accepted.</FieldDescription>
                <FieldError errors={[errors.code]} />
              </Field>
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2Icon className="animate-spin" />}
                {isSubmitting ? "Verifying…" : "Verify"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={isSubmitting} onClick={backToLogin}>
                <ArrowLeftIcon />
                Back to sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    )
  }

  const { errors, isSubmitting } = loginForm.formState

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Sign in to your DisCloud account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={loginForm.handleSubmit(login)}>
          <FieldGroup>
            {formError && <FormAlert error={formError} />}
            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input id="username" autoComplete="username" autoFocus disabled={isSubmitting} aria-invalid={!!errors.username} {...loginForm.register("username")} />
              <FieldError errors={[errors.username]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <PasswordInput id="password" autoComplete="current-password" disabled={isSubmitting} aria-invalid={!!errors.password} {...loginForm.register("password")} />
              <FieldError errors={[errors.password]} />
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="animate-spin" />}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function isMFAChallenge(result: LoginResult): result is MFAChallenge {
  return "mfaRequired" in result && result.mfaRequired === true
}

function FormAlert({ error }: { error: APIFormError }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Authentication failed</AlertTitle>
      <AlertDescription>
        {error.message}
        {error.requestID && <p className="mt-1 font-mono text-xs">Request ID: {error.requestID}</p>}
      </AlertDescription>
    </Alert>
  )
}
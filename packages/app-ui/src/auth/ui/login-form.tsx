"use client"

import { apiFormError, type APIFormError } from "@discloud/api/errors"
import type {
  LoginInput,
  LoginResult,
  MFAChallenge,
  User,
  VerifyLoginMFAInput,
} from "@discloud/api/models"
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
import { Input } from "@discloud/ui/components/input"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowLeftIcon,
  Loader2Icon,
  ShieldCheckIcon,
} from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { AuthFormAlert } from "./form-alert"
import { PasswordInput } from "./password-input"

const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
})

const mfaSchema = z.object({
  code: z.string().trim().min(1, "Authentication code is required"),
})

type LoginValues = z.infer<typeof loginSchema>
type MFAValues = z.infer<typeof mfaSchema>

export function LoginForm({
  login,
  verifyMFA,
  onAuthenticated,
}: {
  login: (input: LoginInput) => Promise<LoginResult>
  verifyMFA: (input: VerifyLoginMFAInput) => Promise<User>
  onAuthenticated: (user: User) => void
}) {
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

  async function submitLogin(values: LoginValues) {
    setFormError(undefined)

    try {
      const result = await login(values)

      if (isMFAChallenge(result)) {
        setChallenge(result)
        mfaForm.reset()
        return
      }

      onAuthenticated(result)
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        setFormError({ message: "Invalid username or password." })
        return
      }

      setFormError(apiFormError(error, "Could not sign in."))
    }
  }

  async function submitMFA(values: MFAValues) {
    if (!challenge) return
    setFormError(undefined)

    try {
      const user = await verifyMFA({
        challengeToken: challenge.challengeToken,
        code: values.code,
      })

      onAuthenticated(user)
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        mfaForm.setError(
          "code",
          { message: "Invalid or expired authentication code" },
          { shouldFocus: true },
        )
        return
      }

      setFormError(
        apiFormError(error, "Could not verify authentication code."),
      )
    }
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
          <CardDescription>
            Enter your authenticator code or an unused recovery code.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={mfaForm.handleSubmit(submitMFA)}>
            <FieldGroup>
              {formError ? (
                <AuthFormAlert
                  error={formError}
                  title="Authentication failed"
                />
              ) : null}

              <Field data-invalid={!!errors.code}>
                <FieldLabel htmlFor="mfa-code">
                  Authentication code
                </FieldLabel>
                <Input
                  id="mfa-code"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  disabled={isSubmitting}
                  aria-invalid={!!errors.code}
                  {...mfaForm.register("code")}
                />
                <FieldDescription>
                  Authenticator and recovery codes are both accepted.
                </FieldDescription>
                <FieldError errors={[errors.code]} />
              </Field>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {isSubmitting ? "Verifying…" : "Verify"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={isSubmitting}
                onClick={backToLogin}
              >
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
        <form onSubmit={loginForm.handleSubmit(submitLogin)}>
          <FieldGroup>
            {formError ? (
              <AuthFormAlert
                error={formError}
                title="Authentication failed"
              />
            ) : null}

            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                disabled={isSubmitting}
                aria-invalid={!!errors.username}
                {...loginForm.register("username")}
              />
              <FieldError errors={[errors.username]} />
            </Field>

            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                disabled={isSubmitting}
                aria-invalid={!!errors.password}
                {...loginForm.register("password")}
              />
              <FieldError errors={[errors.password]} />
            </Field>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
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
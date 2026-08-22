"use client"

import { LoginForm as LoginFormView } from "@discloud/app-ui/auth/login-form"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import type {
  LoginInput,
  LoginResult,
  User,
  VerifyLoginMFAInput,
} from "@/lib/api/models"
import { workspacePath } from "@/lib/workspace/navigation"

export function LoginForm() {
  const router = useRouter()

  async function login(input: LoginInput) {
    return apiJSON<LoginResult>("/api/v1/auth/login", {
      method: "POST",
      body: input,
    })
  }

  async function verifyMFA(input: VerifyLoginMFAInput) {
    return apiJSON<User>("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: input,
    })
  }

  function authenticated(user: User) {
    toast.success("Signed in")
    router.replace(
      user.mustChangePassword
        ? "/change-password"
        : workspacePath(user.username),
    )
    router.refresh()
  }

  return (
    <LoginFormView
      login={login}
      verifyMFA={verifyMFA}
      onAuthenticated={authenticated}
    />
  )
}
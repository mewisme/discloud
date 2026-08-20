import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { connection } from "next/server"

import { LoginForm } from "@/components/auth/login-form"
import type { SetupStatus } from "@/lib/api/models"
import { apiServerJSON } from "@/lib/api/server"
import { authenticatedPath, getCurrentUser } from "@/lib/auth/session"

export const metadata: Metadata = {
  title: "Sign in",
}

export default async function LoginPage() {
  await connection()

  const status = await apiServerJSON<SetupStatus>("/api/v1/setup/status")
  if (status.setupRequired) redirect("/setup")

  const user = await getCurrentUser()
  if (user) redirect(authenticatedPath(user))

  return <LoginForm />
}
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ChangePasswordForm } from "@/components/auth/change-password-form"
import { getCurrentUser } from "@/lib/auth/session"

export const metadata: Metadata = {
  title: "Change password",
}

export default async function ChangePasswordPage() {
  const user = await getCurrentUser()

  if (!user) redirect("/login")
  if (!user.mustChangePassword) redirect("/files")

  return <ChangePasswordForm />
}
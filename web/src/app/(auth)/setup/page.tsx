import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { connection } from "next/server"

import { SetupForm } from "@/components/auth/setup-form"
import type { SetupStatus } from "@/lib/api/models"
import { apiServerJSON } from "@/lib/api/server"

export const metadata: Metadata = {
  title: "Setup",
}

export default async function SetupPage() {
  await connection()
  const status = await apiServerJSON<SetupStatus>("/api/v1/setup/status")

  if (!status.setupRequired) redirect("/login")
  return <SetupForm />
}
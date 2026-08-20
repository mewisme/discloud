import { redirect } from "next/navigation"
import { connection } from "next/server"

import type { SetupStatus } from "@/lib/api/models"
import { apiServerJSON } from "@/lib/api/server"
import { authenticatedPath, getCurrentUser } from "@/lib/auth/session"

export default async function Home() {
  await connection()

  const status = await apiServerJSON<SetupStatus>("/api/v1/setup/status")
  if (status.setupRequired) redirect("/setup")

  const user = await getCurrentUser()
  redirect(user ? authenticatedPath(user) : "/login")
}
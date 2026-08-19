import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/session"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()

  if (!user) redirect("/login")
  if (user.mustChangePassword) redirect("/change-password")

  return children
}
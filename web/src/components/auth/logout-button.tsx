"use client"

import { Button } from "@discloud/ui/components/button"
import { Loader2Icon, LogOutIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"

export function LogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function logout() {
    setPending(true)

    try {
      await apiJSON<void>("/api/v1/auth/logout", { method: "POST" })
      router.replace("/login")
      router.refresh()
    } catch {
      toast.error("Could not sign out")
      setPending(false)
    }
  }

  return (
    <Button variant="outline" disabled={pending} onClick={logout}>
      {pending ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  )
}
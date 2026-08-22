"use client"

import { ChangePasswordForm as ChangePasswordFormView } from "@discloud/app-ui/auth/change-password-form"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import type { ChangePasswordInput } from "@/lib/api/models"
import { workspacePath } from "@/lib/workspace/navigation"

export function ChangePasswordForm({ username }: { username: string }) {
  const router = useRouter()

  async function changePassword(input: ChangePasswordInput) {
    await apiJSON<void>("/api/v1/me/password", {
      method: "PUT",
      body: input,
    })
  }

  function changed() {
    toast.success("Password changed")
    router.replace(workspacePath(username))
    router.refresh()
  }

  return (
    <ChangePasswordFormView
      changePassword={changePassword}
      onChanged={changed}
    />
  )
}
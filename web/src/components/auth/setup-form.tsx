"use client"

import { SetupForm as SetupFormView } from "@discloud/app-ui/auth/setup-form"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import type { SetupInput, SetupResult } from "@/lib/api/models"

export function SetupForm() {
  const router = useRouter()

  async function completeSetup(input: SetupInput) {
    return apiJSON<SetupResult>("/api/v1/setup", {
      method: "POST",
      body: input,
    })
  }

  function completed() {
    toast.success("Administrator created")
    router.replace("/login")
    router.refresh()
  }

  function alreadyCompleted() {
    toast.info("Setup was already completed")
    router.replace("/login")
    router.refresh()
  }

  return (
    <SetupFormView
      completeSetup={completeSetup}
      onCompleted={completed}
      onAlreadyCompleted={alreadyCompleted}
    />
  )
}
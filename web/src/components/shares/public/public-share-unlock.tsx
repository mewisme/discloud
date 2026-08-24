"use client"

import { Button } from "@discloud/ui/components/button"
import { Input } from "@discloud/ui/components/input"
import { KeyRoundIcon, Loader2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import type { FormEvent } from "react"
import { useState } from "react"

import { PublicShareShell } from "@/components/shares/public/public-share-shell"
import { apiDirectURL, apiURL } from "@/lib/api/client"
import { publicShareUnlockPath } from "@/lib/shares/public"

export function PublicShareUnlock({ publicId }: { publicId: string }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || pending) return
    setPending(true)
    setError(undefined)

    try {
      const path = publicShareUnlockPath(publicId)
      const direct = apiDirectURL(path)
      const proxy = apiURL(path)
      await unlock(direct, password)
      if (direct !== proxy) await unlock(proxy, password)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlock this share")
    } finally {
      setPending(false)
    }
  }

  return (
    <PublicShareShell>
      <div className="grid min-h-[60dvh] place-items-center">
        <form className="w-full max-w-sm space-y-4 rounded-xl border bg-background p-6 shadow-sm" onSubmit={submit}>
          <div className="text-center">
            <KeyRoundIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Password required</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter the password to access this public share.</p>
          </div>
          <Input type="password" autoFocus autoComplete="current-password" value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={pending || !password}>
            {pending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
            Unlock
          </Button>
        </form>
      </div>
    </PublicShareShell>
  )
}

async function unlock(url: string, password: string) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json, application/problem+json" },
    body: JSON.stringify({ password }),
  })
  if (response.ok) return
  const problem = await response.json().catch(() => null) as { detail?: string } | null
  throw new Error(problem?.detail || "Could not unlock this share")
}

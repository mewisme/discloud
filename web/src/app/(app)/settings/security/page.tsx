import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { SecuritySettings } from "@/components/settings/security-settings"
import { Button } from "@/components/ui/button"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { MFAStatus } from "@/lib/api/models"

export const metadata: Metadata = {
  title: "Security",
}

export default async function SecurityPage() {
  const status = await apiServerAuthJSON<MFAStatus>("/api/v1/me/mfa")

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/files">
            <ArrowLeftIcon />
            Back to files
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
          <p className="text-sm text-muted-foreground">Manage two-factor authentication and recovery codes.</p>
        </div>
      </div>
      <SecuritySettings initialEnabled={status.enabled} />
    </main>
  )
}
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon, ShieldCheckIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Settings",
}

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your DisCloud account and preferences.</p>
      </div>

      <div className="grid gap-3">
        <Card className="p-0">
          <CardContent className="p-0">
            <Link href="/settings/security" className="flex items-center gap-4 rounded-xl p-4 transition-colors hover:bg-muted/50">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                <ShieldCheckIcon className="size-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-medium">Security</p>
                <p className="text-sm text-muted-foreground">Manage password, two-factor authentication and recovery options.</p>
              </div>

              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">More settings will be available here in future updates.</p>
    </div>
  )
}
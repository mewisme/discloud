"use client"

import { Button } from "@discloud/ui/components/button"
import { Loader2Icon } from "lucide-react"

export function SettingsSaveBar({ dirty, pending, onSave }: { dirty: boolean; pending: boolean; onSave: () => void }) {
  return (
    <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{dirty ? "Unsaved changes" : "Settings are up to date"}</p>
        <p className="text-xs text-muted-foreground">{dirty ? "Save to apply these preferences across your account." : "Your common preferences are saved."}</p>
      </div>
      <Button disabled={!dirty || pending} onClick={onSave}>{pending ? <Loader2Icon className="animate-spin" /> : null}Save changes</Button>
    </div>
  )
}

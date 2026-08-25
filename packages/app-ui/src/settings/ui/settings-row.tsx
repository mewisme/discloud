import { cn } from "@discloud/ui/lib/utils"
import type { ReactNode } from "react"

export function SettingsRow({ title, description, children, last = false }: { title: string; description: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("grid gap-5 py-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]", last && "pb-0 pt-0")}>
      <div><p className="text-sm font-medium">{title}</p><p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p></div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

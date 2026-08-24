import { ShieldCheckIcon } from "lucide-react"
import type { ReactNode } from "react"

export function AdminPageHeader({ action, title = "Admin", description = "Manage users and inspect DisCloud storage state." }: { action?: ReactNode; title?: string; description?: string }) {
  return <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><ShieldCheckIcon className="size-6" /><h1 className="text-2xl font-semibold tracking-tight">{title}</h1></div><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{action}</div>
}

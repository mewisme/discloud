import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { CloudIcon, Globe2Icon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

export function PublicShareShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <CloudIcon className="size-4" />
            </span>
            <span>DisCloud</span>
          </Link>

          <Badge variant="secondary" className="ml-auto">
            <Globe2Icon />
            Public share
          </Badge>

          <Button size="sm" variant="ghost" asChild>
            <Link href="/">Open DisCloud</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}

export function PublicResourceHeading({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border bg-background shadow-sm">
          {icon}
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="truncate text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function PublicInfo({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0 bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 truncate text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

export function UnavailablePublicShare({ message = "This public resource could not be displayed." }: { message?: string }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-center">
      <div>
        <Globe2Icon className="mx-auto mb-3 size-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Share unavailable</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  )
}
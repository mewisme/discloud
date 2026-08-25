import { Button } from "@discloud/ui/components/button"
import { ArrowRightIcon, CloudIcon } from "lucide-react"
import Link from "next/link"

import { GitHub } from "@/components/icons/github"

export function PublicHeader({ appHref, appLabel }: { appHref: string; appLabel: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg border bg-foreground text-background"><CloudIcon className="size-4" /></span>
          <span>DisCloud</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/features" className="transition-colors hover:text-foreground">Features</Link>
          <Link href="/#architecture" className="transition-colors hover:text-foreground">Architecture</Link>
          <Link href="/#self-hosted" className="transition-colors hover:text-foreground">Self-hosting</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-2">
          <Button variant="ghost" size="icon" asChild><a href="https://github.com/mewisme/discloud" target="_blank" rel="noreferrer" aria-label="View DisCloud on GitHub"><GitHub /></a></Button>
          <Button asChild><Link href={appHref}>{appLabel}<ArrowRightIcon data-icon="inline-end" /></Link></Button>
        </div>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div className="flex items-center gap-2 font-medium text-foreground"><CloudIcon className="size-4" />DisCloud</div>
      <p>Self-hosted file storage backed by Discord and PostgreSQL.</p>
    </footer>
  )
}
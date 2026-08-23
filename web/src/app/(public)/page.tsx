import { Button } from "@discloud/ui/components/button"
import {
  ArrowRightIcon,
  BoxesIcon,
  CheckIcon,
  CloudIcon,
  DatabaseIcon,
  Globe2Icon,
  HardDriveIcon,
  LockKeyholeIcon,
  ServerIcon,
  ShieldCheckIcon,
  UploadCloudIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { connection } from "next/server"

import { GitHub } from "@/components/icons/github"
import type { SetupStatus } from "@/lib/api/models"
import { apiServerJSON } from "@/lib/api/server"
import { authenticatedPath, getCurrentUser } from "@/lib/auth/session"

export const metadata: Metadata = {
  title: "Self-hosted file storage",
  description: "Self-hosted multi-user file storage backed by Discord attachments and PostgreSQL.",
}

export default async function Home() {
  await connection()

  const status = await apiServerJSON<SetupStatus>("/api/v1/setup/status")
  if (status.setupRequired) redirect("/setup")

  const user = await getCurrentUser()
  const appHref = user ? authenticatedPath(user) : "/login"
  const appLabel = user
    ? user.mustChangePassword
      ? "Continue setup"
      : "Open workspace"
    : "Sign in"

  return (
    <main className="min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem] overflow-hidden">
        <div className="absolute top-[-16rem] left-1/2 size-[38rem] -translate-x-1/2 rounded-full bg-foreground/[0.035] blur-3xl dark:bg-foreground/[0.025]" />
        <div className="absolute inset-0 mask-b-from-10% mask-b-to-95% bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-25" />
      </div>

      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-lg border bg-foreground text-background">
              <CloudIcon className="size-4" />
            </span>
            <span>DisCloud</span>
          </Link>

          <nav className="ml-auto hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#architecture" className="transition-colors hover:text-foreground">
              Architecture
            </a>
            <a href="#self-hosted" className="transition-colors hover:text-foreground">
              Self-hosting
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <Button variant="ghost" size="icon" asChild>
              <a
                href="https://github.com/mewisme/discloud"
                target="_blank"
                rel="noreferrer"
                aria-label="View DisCloud on GitHub"
              >
                <GitHub />
              </a>
            </Button>

            <Button asChild>
              <Link href={appHref}>
                {appLabel}
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-14 px-5 pt-20 pb-24 sm:px-8 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20 lg:pt-32 lg:pb-32">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            <span className="size-1.5 rounded-full bg-foreground" />
            Self-hosted · Discord-backed
          </div>

          <h1 className="max-w-3xl text-5xl leading-[0.98] font-semibold tracking-[-0.055em] text-balance sm:text-6xl lg:text-7xl">
            Your files.
            <br />
            Your infrastructure.
          </h1>

          <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            DisCloud is a self-hosted multi-user file platform that keeps canonical
            application state in PostgreSQL and stores physical file data using
            Discord attachments.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href={appHref}>
                {appLabel}
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>

            <Button variant="outline" size="lg" asChild>
              <a href="https://github.com/mewisme/discloud" target="_blank" rel="noreferrer">
                <GitHub data-icon="inline-start" />
                View source
              </a>
            </Button>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CheckIcon className="size-3.5 text-foreground" />
              Resumable uploads
            </span>
            <span className="flex items-center gap-1.5">
              <CheckIcon className="size-3.5 text-foreground" />
              Range streaming
            </span>
            <span className="flex items-center gap-1.5">
              <CheckIcon className="size-3.5 text-foreground" />
              MFA
            </span>
            <span className="flex items-center gap-1.5">
              <CheckIcon className="size-3.5 text-foreground" />
              Fine-grained ACLs
            </span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-muted/60 blur-3xl" />

          <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-foreground/[0.06]">
            <div className="flex h-11 items-center gap-1.5 border-b px-4">
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/20" />
              <span className="size-2.5 rounded-full bg-muted-foreground/10" />
              <span className="ml-3 font-mono text-[11px] text-muted-foreground">
                discloud / storage
              </span>
            </div>

            <div className="p-5 sm:p-6">
              <div className="rounded-xl border bg-background p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Upload pipeline</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Adaptive and resumable
                    </p>
                  </div>

                  <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
                    <span className="size-1.5 rounded-full bg-foreground" />
                    Ready
                  </span>
                </div>

                <div className="grid gap-2">
                  <PipelineNode
                    icon={<Globe2Icon />}
                    title="Browser"
                    detail="Direct upload"
                  />
                  <PipelineConnection />
                  <PipelineNode
                    icon={<ServerIcon />}
                    title="DisCloud API"
                    detail="Auth · ACL · chunks"
                  />
                  <PipelineConnection />
                  <div className="grid grid-cols-2 gap-2">
                    <PipelineNode
                      icon={<DatabaseIcon />}
                      title="PostgreSQL"
                      detail="Canonical state"
                    />
                    <PipelineNode
                      icon={<CloudIcon />}
                      title="Discord"
                      detail="Blob storage"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatCard value="Multi-user" label="Workspaces" />
                <StatCard value="Adaptive" label="Uploads" />
                <StatCard value="Direct" label="Media" />
              </div>
            </div>
          </div>

          <div className="absolute -right-4 -bottom-5 hidden items-center gap-3 rounded-xl border bg-background px-4 py-3 shadow-lg sm:flex">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
              <ShieldCheckIcon className="size-4" />
            </span>
            <div>
              <p className="text-xs font-medium">Private by default</p>
              <p className="text-[11px] text-muted-foreground">Session + ACL protected</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-y bg-muted/25">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-28">
          <SectionHeading
            eyebrow="Built for real storage"
            title="More than a file browser."
            description="DisCloud combines the workflows expected from a modern cloud drive with an architecture designed for self-hosting."
          />

          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
            <Feature
              icon={<UploadCloudIcon />}
              title="Resumable uploads"
              description="Chunked uploads, adaptive concurrency and per-session sizing keep transfers reliable across unstable connections."
            />
            <Feature
              icon={<HardDriveIcon />}
              title="Files and folders"
              description="Hierarchical storage with rename, move, trash, restore, favorites, search and folder downloads."
            />
            <Feature
              icon={<UsersIcon />}
              title="Multi-user"
              description="Separate user workspaces, quotas and fine-grained folder and collection access controls."
            />
            <Feature
              icon={<LockKeyholeIcon />}
              title="Secure access"
              description="Server-side sessions, MFA, CSRF protection and permission checks across protected resources."
            />
            <Feature
              icon={<BoxesIcon />}
              title="Collections and shares"
              description="Organize files independently of folders and expose selected content through revocable public shares."
            />
            <Feature
              icon={<ZapIcon />}
              title="Media-aware"
              description="Range requests and direct browser-to-backend access make image, audio and video previews responsive."
            />
          </div>
        </div>
      </section>

      <section id="architecture" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <SectionHeading
              eyebrow="Architecture"
              title="Simple pieces. Clear responsibilities."
              description="The database owns application truth. Discord stores bytes. DisCloud sits between them and enforces the product model."
            />

            <div className="mt-8 space-y-3 text-sm text-muted-foreground">
              <ArchitecturePoint
                icon={<DatabaseIcon />}
                text="PostgreSQL stores users, sessions, nodes, quotas, ACLs and chunk metadata."
              />
              <ArchitecturePoint
                icon={<CloudIcon />}
                text="Discord attachments provide the physical backing storage for committed chunks."
              />
              <ArchitecturePoint
                icon={<ServerIcon />}
                text="The Go backend owns authorization, upload orchestration, streaming and background jobs."
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="border-b px-5 py-4">
              <p className="font-mono text-xs text-muted-foreground">request.flow</p>
            </div>

            <div className="divide-y">
              <FlowRow
                step="01"
                icon={<Globe2Icon />}
                title="Browser"
                description="Uploads, downloads and media requests"
              />
              <FlowRow
                step="02"
                icon={<ShieldCheckIcon />}
                title="DisCloud backend"
                description="Authentication, authorization and orchestration"
              />
              <FlowRow
                step="03"
                icon={<DatabaseIcon />}
                title="PostgreSQL"
                description="Canonical application state and metadata"
              />
              <FlowRow
                step="04"
                icon={<CloudIcon />}
                title="Discord"
                description="Physical chunk attachment storage"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="self-hosted" className="border-y bg-muted/25">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ServerIcon className="size-3.5" />
              SELF-HOSTED
            </div>

            <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              Run the complete stack on infrastructure you control.
            </h2>

            <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
              Backend and frontend ship as separate container images, with PostgreSQL
              as the canonical database and runtime configuration for your deployment.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href={appHref}>
                {appLabel}
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>

            <Button variant="outline" size="lg" asChild>
              <a href="https://github.com/mewisme/discloud" target="_blank" rel="noreferrer">
                <GitHub data-icon="inline-start" />
                GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <CloudIcon className="size-4" />
          DisCloud
        </div>

        <p>Self-hosted file storage backed by Discord and PostgreSQL.</p>
      </footer>
    </main>
  )
}

function PipelineNode({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode
  title: string
  detail: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function PipelineConnection() {
  return (
    <div className="flex h-3 justify-center">
      <span className="h-full w-px bg-border" />
    </div>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-3">
      <p className="text-xs font-medium">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {eyebrow}
      </p>
      <h2 className="text-3xl font-semibold tracking-[-0.04em] text-balance sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 max-w-xl leading-7 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <article className="bg-background p-6 sm:p-7">
      <span className="mb-8 flex size-10 items-center justify-center rounded-lg border bg-muted/40 [&_svg]:size-4">
        {icon}
      </span>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </article>
  )
}

function ArchitecturePoint({
  icon,
  text,
}: {
  icon: React.ReactNode
  text: string
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border text-foreground [&_svg]:size-3.5">
        {icon}
      </span>
      <p className="leading-6">{text}</p>
    </div>
  )
}

function FlowRow({
  step,
  icon,
  title,
  description,
}: {
  step: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="grid grid-cols-[2.5rem_2.5rem_1fr] items-center gap-3 p-5 sm:grid-cols-[3rem_2.75rem_1fr] sm:p-6">
      <span className="font-mono text-xs text-muted-foreground">{step}</span>
      <span className="flex size-10 items-center justify-center rounded-lg border bg-muted/40 [&_svg]:size-4">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
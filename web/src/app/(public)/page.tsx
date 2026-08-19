import { Cloud } from "lucide-react"

export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-2xl border bg-card shadow-sm">
          <Cloud className="size-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">DisCloud</h1>
          <p className="text-muted-foreground">Self-hosted file storage backed by Discord attachments.</p>
        </div>
      </div>
    </main>
  )
}
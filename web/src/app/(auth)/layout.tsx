import type { ReactNode } from "react"
import { Cloud } from "lucide-react"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid size-11 place-items-center rounded-xl border bg-background shadow-sm">
            <Cloud className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">DisCloud</div>
            <div className="text-sm text-muted-foreground">Self-hosted file storage</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  )
}
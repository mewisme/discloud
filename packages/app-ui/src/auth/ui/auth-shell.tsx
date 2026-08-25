import type { ReactNode } from "react"

import { AppIcon } from "../../shared/ui/app-icon"

export function AuthShell({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <AppIcon className="size-11 rounded-xl shadow-sm" />
          <div>
            <div className="text-lg font-semibold tracking-tight">DisCloud</div>
            <div className="text-sm text-muted-foreground">
              Self-hosted file storage
            </div>
          </div>
        </div>

        {children}
        {footer}
      </div>
    </main>
  )
}
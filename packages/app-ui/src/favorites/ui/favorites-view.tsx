"use client"

import { Button } from "@discloud/ui/components/button"
import { HeartIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import type { ReactNode } from "react"

export function FavoritesView({ username, count, loading, error, onRetry, results, pagination }: { username?: string; count: number; loading?: boolean; error?: string; onRetry?: () => void; results?: ReactNode; pagination?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Favorites</h1><p className="text-sm text-muted-foreground">{username ? <>Favorite files and folders in @{username}&apos;s workspace.</> : "Favorite files and folders in this workspace."}</p></div>
      {loading ? (
        <div className="grid min-h-64 place-items-center rounded-xl border"><div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" aria-hidden />Loading favorites…</div></div>
      ) : error && count === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center"><div className="space-y-3"><div role="alert"><p className="font-medium">Favorites unavailable</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></div>{onRetry ? <Button size="sm" variant="outline" onClick={onRetry}><RefreshCwIcon />Try again</Button> : null}</div></div>
      ) : count === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center"><div><div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-muted"><HeartIcon className="size-5 text-muted-foreground" /></div><p className="font-medium">No favorites yet</p><p className="mt-1 text-sm text-muted-foreground">Add files or folders to favorites from the File Browser.</p></div></div>
      ) : (
        <div className="space-y-4">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}{results}{pagination}</div>
      )}
    </div>
  )
}

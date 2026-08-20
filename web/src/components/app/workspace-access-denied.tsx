import { ShieldXIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { workspacePath } from "@/lib/workspace/navigation"

export function WorkspaceAccessDenied({ username, currentUsername }: { username: string; currentUsername: string }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-destructive/10">
          <ShieldXIcon className="size-6 text-destructive" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Workspace access denied</h1>
          <p className="text-sm text-muted-foreground">
            You do not have permission to enter {username}&apos;s workspace.
          </p>
        </div>
        <Button asChild>
          <Link href={workspacePath(currentUsername)}>Return to your workspace</Link>
        </Button>
      </div>
    </main>
  )
}
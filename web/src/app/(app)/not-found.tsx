import { FileQuestionIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function AppNotFound() {
  return (
    <div className="mx-auto grid min-h-[60vh] w-full max-w-3xl place-items-center py-10">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-muted">
          <FileQuestionIcon className="size-6 text-muted-foreground" />
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            This page does not exist or is no longer available.
          </p>
        </div>

        <Button asChild>
          <Link href="/">Back to workspace</Link>
        </Button>
      </div>
    </div>
  )
}
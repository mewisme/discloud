import { FileQuestion } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <FileQuestion className="size-10 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Page not found</h1>
          <p className="text-sm text-muted-foreground">The requested page does not exist or is no longer available.</p>
        </div>
        <Button asChild>
          <Link href="/">Back to DisCloud</Link>
        </Button>
      </div>
    </main>
  )
}
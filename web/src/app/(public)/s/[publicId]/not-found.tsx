import { Globe2Icon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function PublicShareNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/20 p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl border bg-background shadow-sm">
          <Globe2Icon className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Public link unavailable</h1>
          <p className="text-sm text-muted-foreground">This link may have been revoked, regenerated, or the shared resource is no longer available.</p>
        </div>
        <Button asChild>
          <Link href="/">Open DisCloud</Link>
        </Button>
      </div>
    </main>
  )
}
import { FolderXIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function FolderNotFound() {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-4">
        <FolderXIcon className="mx-auto size-10 text-muted-foreground" />
        <div>
          <p className="font-medium">Folder unavailable</p>
          <p className="text-sm text-muted-foreground">It may have been moved, deleted, or you may no longer have access.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/files">Back to files</Link>
        </Button>
      </div>
    </div>
  )
}
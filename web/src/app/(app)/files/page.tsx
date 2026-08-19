import type { Metadata } from "next"
import { FolderOpenIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Files",
}

export default function FilesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">Browse and manage your DisCloud storage.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpenIcon className="size-4" />
            File browser
          </CardTitle>
          <CardDescription>Your authenticated application shell is ready.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Folder navigation and file browsing are implemented in Phase 7.</p>
        </CardContent>
      </Card>
    </div>
  )
}
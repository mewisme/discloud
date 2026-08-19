import Link from "next/link"
import { FolderOpenIcon, ShieldCheckIcon } from "lucide-react"
import { LogoutButton } from "@/components/auth/logout-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export default function FilesPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpenIcon className="size-4" />
            Files
          </CardTitle>
          <CardDescription>You are signed in. The file browser will be implemented in the upcoming client phases.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Your authenticated DisCloud session is active.</p>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/settings/security">
              <ShieldCheckIcon />
              Security
            </Link>
          </Button>
          <LogoutButton />
        </CardFooter>
      </Card>
    </main>
  )
}
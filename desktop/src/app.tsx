import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@discloud/ui/components/card"

export function App() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardDescription>DisCloud</CardDescription>
              <CardTitle className="mt-1">Desktop</CardTitle>
            </div>
            <Badge variant="secondary">Ready</Badge>
          </div>
        </CardHeader>

        <CardContent>
          <p className="text-muted-foreground">
            Tauri now uses the shared DisCloud design system.
          </p>
        </CardContent>

        <CardFooter>
          <Button className="w-full" disabled>
            Ready for server connection
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
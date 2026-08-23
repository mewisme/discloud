import { Alert, AlertDescription } from "@discloud/ui/components/alert"
import { TriangleAlertIcon } from "lucide-react"

export function NodeActionError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
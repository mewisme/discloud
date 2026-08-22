import type { APIFormError } from "@discloud/api/errors"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@discloud/ui/components/alert"
import { TriangleAlertIcon } from "lucide-react"

export function AuthFormAlert({
  error,
  title,
}: {
  error: APIFormError
  title: string
}) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {error.message}
        {error.requestID ? (
          <p className="mt-1 font-mono text-xs">
            Request ID: {error.requestID}
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
import { AuthShell } from "@discloud/app-ui/auth/auth-shell"
import { Button } from "@discloud/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@discloud/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { LoaderCircle } from "lucide-react"
import { type FormEvent, useState } from "react"

import {
  connectServer,
  errorMessage,
  type ServerConnection,
} from "#lib/instance"
import { saveServerUrl } from "#lib/settings"

type ServerConnectionScreenProps = {
  initialServerUrl?: string
  initialError?: string
  onConnected: (connection: ServerConnection) => void
}

export function ServerConnectionScreen({
  initialServerUrl = "",
  initialError,
  onConnected,
}: ServerConnectionScreenProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const [error, setError] = useState(initialError)
  const [connecting, setConnecting] = useState(false)

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (connecting) return

    setConnecting(true)
    setError(undefined)

    try {
      const connection = await connectServer(serverUrl)

      await saveServerUrl(connection.serverUrl)
      setServerUrl(connection.serverUrl)
      onConnected(connection)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Connect to DisCloud</CardTitle>
          <CardDescription>
            Enter the address of your DisCloud server.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={connect}>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="server-url">Server</FieldLabel>
              <Input
                id="server-url"
                type="text"
                value={serverUrl}
                placeholder="https://cloud.example.com"
                aria-invalid={!!error}
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                disabled={connecting}
                onChange={(event) => setServerUrl(event.target.value)}
              />
              <FieldDescription>
                HTTPS is used automatically when no protocol is specified.
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>

            <Button
              type="submit"
              className="w-full"
              disabled={connecting || !serverUrl.trim()}
            >
              {connecting ? (
                <>
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                  Connecting
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
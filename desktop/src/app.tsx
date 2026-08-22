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
import { Cloud, LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { ServerConnectionScreen } from "#components/server-connection"
import {
  errorMessage,
  probeServer,
  type ServerConnection,
} from "#lib/instance"
import { loadServerUrl } from "#lib/settings"

type AppState =
  | { status: "loading" }
  | {
    status: "disconnected"
    serverUrl?: string
    error?: string
  }
  | {
    status: "connected"
    connection: ServerConnection
  }

export function App() {
  const [state, setState] = useState<AppState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const serverUrl = await loadServerUrl()

        if (cancelled) return

        if (!serverUrl) {
          setState({ status: "disconnected" })
          return
        }

        try {
          const connection = await probeServer(serverUrl)

          if (!cancelled) {
            setState({ status: "connected", connection })
          }
        } catch (error) {
          if (!cancelled) {
            setState({
              status: "disconnected",
              serverUrl,
              error: errorMessage(error),
            })
          }
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "disconnected",
            error: `Could not load desktop settings: ${errorMessage(error)}`,
          })
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === "loading") {
    return <LoadingScreen />
  }

  if (state.status === "disconnected") {
    return (
      <ServerConnectionScreen
        initialServerUrl={state.serverUrl}
        initialError={state.error}
        onConnected={(connection) =>
          setState({ status: "connected", connection })
        }
      />
    )
  }

  return (
    <ConnectedScreen
      connection={state.connection}
      onChangeServer={() =>
        setState({
          status: "disconnected",
          serverUrl: state.connection.serverUrl,
        })
      }
    />
  )
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-6">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        <span className="text-sm">Connecting to DisCloud</span>
      </div>
    </main>
  )
}

function ConnectedScreen({
  connection,
  onChangeServer,
}: {
  connection: ServerConnection
  onChangeServer: () => void
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid size-11 place-items-center rounded-xl border bg-background shadow-sm">
            <Cloud className="size-5" />
          </div>

          <div>
            <div className="text-lg font-semibold tracking-tight">DisCloud</div>
            <div className="text-sm text-muted-foreground">
              Self-hosted file storage
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>Server connected</CardTitle>
                <CardDescription className="mt-1 truncate">
                  {connection.serverUrl}
                </CardDescription>
              </div>

              <Badge variant="secondary">Connected</Badge>
            </div>
          </CardHeader>

          <CardContent>
            <p className="text-sm text-muted-foreground">
              {connection.setupRequired
                ? "This server requires initial setup before you can sign in."
                : "This server is configured and ready for sign in."}
            </p>
          </CardContent>

          <CardFooter>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onChangeServer}
            >
              Change server
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
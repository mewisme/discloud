import type { User } from "@discloud/api/models"
import { AuthShell } from "@discloud/app-ui/auth/auth-shell"
import { ChangePasswordForm } from "@discloud/app-ui/auth/change-password-form"
import { LoginForm } from "@discloud/app-ui/auth/login-form"
import { SetupForm } from "@discloud/app-ui/auth/setup-form"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@discloud/ui/components/alert"
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
import {
  LoaderCircle,
  LogOutIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { ServerConnectionScreen } from "#components/server-connection"
import {
  changePassword,
  completeSetup,
  getCurrentUser,
  login,
  logout,
  verifyMFA,
} from "#lib/auth"
import {
  connectServer,
  disconnectServer,
  errorMessage,
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
    status: "setup"
    serverUrl: string
  }
  | {
    status: "login"
    serverUrl: string
  }
  | {
    status: "change-password"
    serverUrl: string
    user: User
  }
  | {
    status: "authenticated"
    serverUrl: string
    user: User
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

        const connection = await connectServer(serverUrl)
        const nextState = await stateForConnection(connection)

        if (!cancelled) setState(nextState)
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "disconnected",
            error: errorMessage(error),
          })
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  async function connected(connection: ServerConnection) {
    setState({ status: "loading" })

    try {
      setState(await stateForConnection(connection))
    } catch (error) {
      setState({
        status: "disconnected",
        serverUrl: connection.serverUrl,
        error: errorMessage(error),
      })
    }
  }

  async function changeServer(serverUrl: string) {
    try {
      await disconnectServer()
    } catch {
      // Replacing the client state below is still safe.
    }

    setState({
      status: "disconnected",
      serverUrl,
    })
  }

  if (state.status === "loading") return <LoadingScreen />

  if (state.status === "disconnected") {
    return (
      <ServerConnectionScreen
        initialServerUrl={state.serverUrl}
        initialError={state.error}
        onConnected={(connection) => void connected(connection)}
      />
    )
  }

  if (state.status === "setup") {
    return (
      <AuthScreen
        serverUrl={state.serverUrl}
        onChangeServer={() => void changeServer(state.serverUrl)}
      >
        <SetupForm
          completeSetup={completeSetup}
          onCompleted={() =>
            setState({
              status: "login",
              serverUrl: state.serverUrl,
            })
          }
          onAlreadyCompleted={() =>
            setState({
              status: "login",
              serverUrl: state.serverUrl,
            })
          }
        />
      </AuthScreen>
    )
  }

  if (state.status === "login") {
    return (
      <AuthScreen
        serverUrl={state.serverUrl}
        onChangeServer={() => void changeServer(state.serverUrl)}
      >
        <LoginForm
          login={login}
          verifyMFA={verifyMFA}
          onAuthenticated={(user) =>
            setState(authenticatedState(state.serverUrl, user))
          }
        />
      </AuthScreen>
    )
  }

  if (state.status === "change-password") {
    return (
      <AuthScreen
        serverUrl={state.serverUrl}
        onChangeServer={() => void changeServer(state.serverUrl)}
      >
        <ChangePasswordForm
          changePassword={changePassword}
          onChanged={async () => {
            const user = await getCurrentUser()

            setState(
              user
                ? authenticatedState(state.serverUrl, user)
                : {
                  status: "login",
                  serverUrl: state.serverUrl,
                },
            )
          }}
        />
      </AuthScreen>
    )
  }

  return (
    <AuthenticatedScreen
      serverUrl={state.serverUrl}
      user={state.user}
      onChangeServer={() => void changeServer(state.serverUrl)}
      onLogout={async () => {
        await logout()

        setState({
          status: "login",
          serverUrl: state.serverUrl,
        })
      }}
    />
  )
}

async function stateForConnection(
  connection: ServerConnection,
): Promise<AppState> {
  if (connection.setupRequired) {
    return {
      status: "setup",
      serverUrl: connection.serverUrl,
    }
  }

  const user = await getCurrentUser()

  return user
    ? authenticatedState(connection.serverUrl, user)
    : {
      status: "login",
      serverUrl: connection.serverUrl,
    }
}

function authenticatedState(serverUrl: string, user: User): AppState {
  return user.mustChangePassword
    ? {
      status: "change-password",
      serverUrl,
      user,
    }
    : {
      status: "authenticated",
      serverUrl,
      user,
    }
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

function AuthScreen({
  serverUrl,
  onChangeServer,
  children,
}: {
  serverUrl: string
  onChangeServer: () => void
  children: ReactNode
}) {
  return (
    <AuthShell
      footer={
        <ServerFooter
          serverUrl={serverUrl}
          onChangeServer={onChangeServer}
        />
      }
    >
      {children}
    </AuthShell>
  )
}

function ServerFooter({
  serverUrl,
  onChangeServer,
}: {
  serverUrl: string
  onChangeServer: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="min-w-0 truncate text-xs text-muted-foreground"
        title={serverUrl}
      >
        {serverUrl}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={onChangeServer}
      >
        Change server
      </Button>
    </div>
  )
}

function AuthenticatedScreen({
  serverUrl,
  user,
  onChangeServer,
  onLogout,
}: {
  serverUrl: string
  user: User
  onChangeServer: () => void
  onLogout: () => Promise<void>
}) {
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string>()

  async function submitLogout() {
    if (loggingOut) return

    setLoggingOut(true)
    setError(undefined)

    try {
      await onLogout()
    } catch (error) {
      setError(errorMessage(error))
      setLoggingOut(false)
    }
  }

  return (
    <AuthShell
      footer={
        <ServerFooter
          serverUrl={serverUrl}
          onChangeServer={onChangeServer}
        />
      }
    >
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle>{user.name}</CardTitle>
              <CardDescription>@{user.username}</CardDescription>
            </div>
            <Badge variant="secondary">{user.role}</Badge>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Could not sign out</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Authentication is ready. The desktop application shell will be
            connected in the next step.
          </p>
        </CardContent>

        <CardFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={loggingOut}
            onClick={() => void submitLogout()}
          >
            {loggingOut ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <LogOutIcon />
            )}
            {loggingOut ? "Signing out…" : "Sign out"}
          </Button>
        </CardFooter>
      </Card>
    </AuthShell>
  )
}
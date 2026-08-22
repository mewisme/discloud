import type { User } from "@discloud/api/models"
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  getCurrentUser,
  logout,
} from "#lib/auth"
import {
  connectServer,
  disconnectServer,
  errorMessage,
  type ServerConnection,
} from "#lib/instance"
import { loadServerUrl } from "#lib/settings"

export type DesktopSessionState =
  | {
    status: "loading"
  }
  | {
    status: "disconnected"
    serverUrl?: string
    error?: string
  }
  | {
    status: "connected"
    serverUrl: string
    setupRequired: boolean
    user: User | null
  }

export type ConnectedDesktopSessionState = Extract<
  DesktopSessionState,
  { status: "connected" }
>

type DesktopSessionContextValue = {
  state: DesktopSessionState
  acceptConnection: (connection: ServerConnection) => Promise<void>
  changeServer: () => Promise<void>
  markSetupCompleted: () => void
  setAuthenticated: (user: User) => void
  refreshUser: () => Promise<User | null>
  signOut: () => Promise<void>
}

const DesktopSessionContext =
  createContext<DesktopSessionContextValue | null>(null)

export function DesktopSessionProvider({
  children,
}: {
  children: ReactNode
}) {
  const [state, setState] = useState<DesktopSessionState>({
    status: "loading",
  })

  useEffect(() => {
    let cancelled = false
    let storedServerUrl: string | null = null

    async function bootstrap() {
      try {
        storedServerUrl = await loadServerUrl()

        if (cancelled) return

        if (!storedServerUrl) {
          setState({ status: "disconnected" })
          return
        }

        const connection = await connectServer(storedServerUrl)
        const nextState = await connectedState(connection)

        if (!cancelled) setState(nextState)
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "disconnected",
            serverUrl: storedServerUrl ?? undefined,
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

  const acceptConnection = useCallback(
    async (connection: ServerConnection) => {
      setState({ status: "loading" })

      try {
        setState(await connectedState(connection))
      } catch (error) {
        setState({
          status: "disconnected",
          serverUrl: connection.serverUrl,
          error: errorMessage(error),
        })
      }
    },
    [],
  )

  const changeServer = useCallback(async () => {
    let serverUrl: string | undefined

    setState((current) => {
      serverUrl =
        current.status === "connected" ||
          current.status === "disconnected"
          ? current.serverUrl
          : undefined

      return current
    })

    try {
      await disconnectServer()
    } catch {
      // The next connection replaces the native client anyway.
    }

    setState({
      status: "disconnected",
      serverUrl,
    })
  }, [])

  const markSetupCompleted = useCallback(() => {
    setState((current) =>
      current.status === "connected"
        ? {
          ...current,
          setupRequired: false,
          user: null,
        }
        : current,
    )
  }, [])

  const setAuthenticated = useCallback((user: User) => {
    setState((current) =>
      current.status === "connected"
        ? {
          ...current,
          setupRequired: false,
          user,
        }
        : current,
    )
  }, [])

  const refreshUser = useCallback(async () => {
    const user = await getCurrentUser()

    setState((current) =>
      current.status === "connected"
        ? {
          ...current,
          user,
        }
        : current,
    )

    return user
  }, [])

  const signOut = useCallback(async () => {
    await logout()

    setState((current) =>
      current.status === "connected"
        ? {
          ...current,
          user: null,
        }
        : current,
    )
  }, [])

  const value = useMemo<DesktopSessionContextValue>(
    () => ({
      state,
      acceptConnection,
      changeServer,
      markSetupCompleted,
      setAuthenticated,
      refreshUser,
      signOut,
    }),
    [
      state,
      acceptConnection,
      changeServer,
      markSetupCompleted,
      setAuthenticated,
      refreshUser,
      signOut,
    ],
  )

  return (
    <DesktopSessionContext.Provider value={value}>
      {children}
    </DesktopSessionContext.Provider>
  )
}

export function useDesktopSession() {
  const context = useContext(DesktopSessionContext)

  if (!context) {
    throw new Error(
      "useDesktopSession must be used within DesktopSessionProvider",
    )
  }

  return context
}

async function connectedState(
  connection: ServerConnection,
): Promise<ConnectedDesktopSessionState> {
  return {
    status: "connected",
    serverUrl: connection.serverUrl,
    setupRequired: connection.setupRequired,
    user: connection.setupRequired
      ? null
      : await getCurrentUser(),
  }
}
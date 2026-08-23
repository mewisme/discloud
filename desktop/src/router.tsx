import type { User } from "@discloud/api/models"
import { AuthShell } from "@discloud/app-ui/auth/auth-shell"
import { appRouteTitle, workspacePath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { LoaderCircle } from "lucide-react"
import { lazy, type ReactNode, Suspense } from "react"
import { createHashRouter, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router"

import { type ConnectedDesktopSessionState, useDesktopSession } from "#components/desktop-session"
import { changePassword, completeSetup, login, verifyMFA } from "#lib/auth"

import { DesktopUserConfigProvider } from "./features/settings/ui/user-config-provider"
import { DesktopSyncProvider } from "./features/sync/ui/sync-provider"
import { DesktopUploadProvider } from "./features/uploads/ui/upload-provider"

const ChangePasswordForm = lazy(() => import("@discloud/app-ui/auth/change-password-form").then((module) => ({ default: module.ChangePasswordForm })))
const LoginForm = lazy(() => import("@discloud/app-ui/auth/login-form").then((module) => ({ default: module.LoginForm })))
const SetupForm = lazy(() => import("@discloud/app-ui/auth/setup-form").then((module) => ({ default: module.SetupForm })))
const DesktopAppLayout = lazy(() => import("#components/desktop-shell").then((module) => ({ default: module.DesktopAppLayout })))
const ServerConnectionScreen = lazy(() => import("#components/server-connection").then((module) => ({ default: module.ServerConnectionScreen })))
const DesktopCollectionFilePage = lazy(() => import("./features/collections/collection-file-page").then((module) => ({ default: module.DesktopCollectionFilePage })))
const DesktopCollectionPage = lazy(() => import("./features/collections/collection-page").then((module) => ({ default: module.DesktopCollectionPage })))
const DesktopCollectionsPage = lazy(() => import("./features/collections/collections-page").then((module) => ({ default: module.DesktopCollectionsPage })))
const DesktopFavoritesPage = lazy(() => import("./features/favorites/favorites-page").then((module) => ({ default: module.DesktopFavoritesPage })))
const DesktopFilePage = lazy(() => import("./features/files/file-page").then((module) => ({ default: module.DesktopFilePage })))
const DesktopFilesPage = lazy(() => import("./features/files/files-page").then((module) => ({ default: module.DesktopFilesPage })))
const DesktopSearchPage = lazy(() => import("./features/search/search-page").then((module) => ({ default: module.DesktopSearchPage })))
const DesktopSettingsPage = lazy(() => import("./features/settings/ui/settings-page").then((module) => ({ default: module.DesktopSettingsPage })))
const DesktopCommonSettingsPage = lazy(() => import("./features/settings/ui/common-settings-page").then((module) => ({ default: module.DesktopCommonSettingsPage })))
const DesktopNativeSettingsPage = lazy(() => import("./features/settings/ui/desktop-settings-page").then((module) => ({ default: module.DesktopNativeSettingsPage })))
const DesktopProfileSettingsPage = lazy(() => import("./features/settings/ui/profile-settings-page").then((module) => ({ default: module.DesktopProfileSettingsPage })))
const DesktopSecuritySettingsPage = lazy(() => import("./features/settings/ui/security-settings-page").then((module) => ({ default: module.DesktopSecuritySettingsPage })))
const DesktopSharedPage = lazy(() => import("./features/shared/shared-page").then((module) => ({ default: module.DesktopSharedPage })))
const DesktopSyncPage = lazy(() => import("./features/sync/ui/sync-page").then((module) => ({ default: module.DesktopSyncPage })))
const DesktopTrashPage = lazy(() => import("./features/trash/trash-page").then((module) => ({ default: module.DesktopTrashPage })))
const DesktopUploadsPage = lazy(() => import("./features/uploads/ui/uploads-page").then((module) => ({ default: module.DesktopUploadsPage })))

export const router = createHashRouter([
  { path: "/", Component: RootRoute },
  { path: "/connect", Component: ConnectRoute },
  { path: "/setup", Component: SetupRoute },
  { path: "/login", Component: LoginRoute },
  { path: "/change-password", Component: ChangePasswordRoute },
  {
    path: "/:username",
    Component: AuthenticatedRoute,
    children: [
      { index: true, Component: FilesRoute },
      { path: "folders/:folderId", Component: FilesRoute },
      { path: "files/:fileId", Component: FileRoute },
      { path: "search", Component: SearchRoute },
      { path: "favorites", Component: FavoritesRoute },
      { path: "collections", Component: CollectionsRoute },
      { path: "collections/:collectionId", Component: CollectionRoute },
      { path: "collections/:collectionId/files/:fileId", Component: CollectionFileRoute },
      { path: "shared", Component: SharedRoute },
      { path: "trash", Component: TrashRoute },
      {
        Component: ActorRouteGuard,
        children: [
          { path: "uploads", Component: UploadsRoute },
          { path: "sync", Component: SyncRoute },
          { path: "settings", Component: SettingsRoute },
          { path: "settings/common", Component: CommonSettingsRoute },
          { path: "settings/desktop", Component: DesktopSettingsRoute },
          { path: "settings/profile", Component: ProfileSettingsRoute },
          { path: "settings/security", Component: SecuritySettingsRoute },
          {
            Component: AdminRouteGuard,
            children: [
              { path: "admin", Component: RoutePlaceholder },
              { path: "admin/bots", Component: RoutePlaceholder },
              { path: "admin/diagnostics", Component: RoutePlaceholder },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", Component: NotFoundRoute },
])

function RootRoute() {
  const { state } = useDesktopSession()
  if (state.status === "loading") return <LoadingScreen />
  if (state.status === "disconnected") return <Navigate to="/connect" replace />
  return <Navigate to={connectedTarget(state)} replace />
}

function ConnectRoute() {
  const { state, acceptConnection } = useDesktopSession()
  if (state.status === "loading") return <LoadingScreen />
  if (state.status === "connected") return <Navigate to={connectedTarget(state)} replace />
  return <Suspense fallback={<LoadingScreen label="Loading connection screen" />}><ServerConnectionScreen initialServerUrl={state.serverUrl} initialError={state.error} onConnected={(connection) => void acceptConnection(connection)} /></Suspense>
}

function SetupRoute() {
  const { state, markSetupCompleted } = useDesktopSession()
  const navigate = useNavigate()

  if (state.status === "loading") return <LoadingScreen />
  if (state.status === "disconnected") return <Navigate to="/connect" replace />
  if (!state.setupRequired) return <Navigate to={connectedTarget(state)} replace />

  function completed() {
    markSetupCompleted()
    navigate("/login", { replace: true })
  }

  return <AuthRouteFrame serverUrl={state.serverUrl}><Suspense fallback={<AuthContentLoading />}><SetupForm completeSetup={completeSetup} onCompleted={completed} onAlreadyCompleted={completed} /></Suspense></AuthRouteFrame>
}

function LoginRoute() {
  const { state, setAuthenticated } = useDesktopSession()
  const navigate = useNavigate()

  if (state.status === "loading") return <LoadingScreen />
  if (state.status === "disconnected") return <Navigate to="/connect" replace />
  if (state.setupRequired) return <Navigate to="/setup" replace />
  if (state.user) return <Navigate to={authenticatedPath(state.user)} replace />

  function authenticated(user: User) {
    setAuthenticated(user)
    navigate(authenticatedPath(user), { replace: true })
  }

  return <AuthRouteFrame serverUrl={state.serverUrl}><Suspense fallback={<AuthContentLoading />}><LoginForm login={login} verifyMFA={verifyMFA} onAuthenticated={authenticated} /></Suspense></AuthRouteFrame>
}

function ChangePasswordRoute() {
  const { state, refreshUser } = useDesktopSession()
  const navigate = useNavigate()

  if (state.status === "loading") return <LoadingScreen />
  if (state.status === "disconnected") return <Navigate to="/connect" replace />
  if (state.setupRequired) return <Navigate to="/setup" replace />
  if (!state.user) return <Navigate to="/login" replace />
  if (!state.user.mustChangePassword) return <Navigate to={workspacePath(state.user.username)} replace />

  return <AuthRouteFrame serverUrl={state.serverUrl}><Suspense fallback={<AuthContentLoading />}><ChangePasswordForm changePassword={changePassword} onChanged={async () => {
    const user = await refreshUser()
    navigate(user ? authenticatedPath(user) : "/login", { replace: true })
  }} /></Suspense></AuthRouteFrame>
}

function AuthenticatedRoute() {
  const { state } = useDesktopSession()

  if (state.status === "loading") return <LoadingScreen />
  if (state.status === "disconnected") return <Navigate to="/connect" replace />
  if (state.setupRequired) return <Navigate to="/setup" replace />
  if (!state.user) return <Navigate to="/login" replace />
  if (state.user.mustChangePassword) return <Navigate to="/change-password" replace />

  return (
    <DesktopSyncProvider>
      <DesktopUserConfigProvider>
        <DesktopUploadProvider>
          <Suspense fallback={<LoadingScreen label="Loading workspace" />}>
            <DesktopAppLayout serverUrl={state.serverUrl} user={state.user} />
          </Suspense>
        </DesktopUploadProvider>
      </DesktopUserConfigProvider>
    </DesktopSyncProvider>
  )
}

function FilesRoute() {
  return <RouteSuspense label="Loading files"><DesktopFilesPage /></RouteSuspense>
}

function FileRoute() {
  return <RouteSuspense label="Loading file"><DesktopFilePage /></RouteSuspense>
}

function SearchRoute() {
  return <RouteSuspense label="Loading search"><DesktopSearchPage /></RouteSuspense>
}

function FavoritesRoute() {
  return <RouteSuspense label="Loading favorites"><DesktopFavoritesPage /></RouteSuspense>
}

function CollectionsRoute() {
  return <RouteSuspense label="Loading collections"><DesktopCollectionsPage /></RouteSuspense>
}

function CollectionRoute() {
  return <RouteSuspense label="Loading collection"><DesktopCollectionPage /></RouteSuspense>
}

function CollectionFileRoute() {
  return <RouteSuspense label="Loading file"><DesktopCollectionFilePage /></RouteSuspense>
}

function SharedRoute() {
  return <RouteSuspense label="Loading shared items"><DesktopSharedPage /></RouteSuspense>
}

function TrashRoute() {
  return <RouteSuspense label="Loading trash"><DesktopTrashPage /></RouteSuspense>
}

function UploadsRoute() {
  return <RouteSuspense label="Loading uploads"><DesktopUploadsPage /></RouteSuspense>
}

function SyncRoute() {
  return <RouteSuspense label="Loading sync"><DesktopSyncPage /></RouteSuspense>
}

function SettingsRoute() {
  return <RouteSuspense label="Loading settings"><DesktopSettingsPage /></RouteSuspense>
}

function CommonSettingsRoute() {
  return <RouteSuspense label="Loading common settings"><DesktopCommonSettingsPage /></RouteSuspense>
}

function DesktopSettingsRoute() {
  return <RouteSuspense label="Loading desktop settings"><DesktopNativeSettingsPage /></RouteSuspense>
}

function ProfileSettingsRoute() {
  return <RouteSuspense label="Loading profile settings"><DesktopProfileSettingsPage /></RouteSuspense>
}

function SecuritySettingsRoute() {
  return <RouteSuspense label="Loading security settings"><DesktopSecuritySettingsPage /></RouteSuspense>
}

function RouteSuspense({ label, children }: { label: string; children: ReactNode }) {
  return <Suspense fallback={<RouteContentLoading label={label} />}>{children}</Suspense>
}

function ActorRouteGuard() {
  const { state } = useDesktopSession()
  const location = useLocation()
  const params = useParams()

  if (state.status !== "connected" || !state.user || !params.username) return <Outlet />
  if (params.username === state.user.username) return <Outlet />

  const currentRoot = workspacePath(params.username)
  const suffix = location.pathname.startsWith(`${currentRoot}/`) ? location.pathname.slice(currentRoot.length) : ""

  return <Navigate to={`${workspacePath(state.user.username)}${suffix}`} replace />
}

function AdminRouteGuard() {
  const { state } = useDesktopSession()

  if (state.status !== "connected" || !state.user) return <Outlet />
  if (state.user.role === "admin") return <Outlet />

  return <Navigate to={workspacePath(state.user.username)} replace />
}

function RoutePlaceholder() {
  const { state } = useDesktopSession()
  const location = useLocation()
  const params = useParams()

  if (state.status !== "connected" || !state.user) return null

  const workspaceUsername = params.username ?? state.user.username
  const title = appRouteTitle(location.pathname, workspaceUsername)

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>This desktop route is wired and ready for its feature implementation.</CardDescription>
      </CardHeader>
      <CardContent><p className="text-sm text-muted-foreground">Workspace: @{workspaceUsername}</p></CardContent>
    </Card>
  )
}

function AuthRouteFrame({ serverUrl, children }: { serverUrl: string; children: ReactNode }) {
  const { changeServer } = useDesktopSession()
  const navigate = useNavigate()

  return (
    <AuthShell footer={
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={serverUrl}>{serverUrl}</span>
        <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => void changeServer().then(() => navigate("/connect", { replace: true }))}>Change server</Button>
      </div>
    }>
      {children}
    </AuthShell>
  )
}

function LoadingScreen({ label = "Connecting to DisCloud" }: { label?: string }) {
  return <main className="grid min-h-screen place-items-center bg-muted/30 p-6"><div className="flex flex-col items-center gap-3 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /><span className="text-sm">{label}</span></div></main>
}

function RouteContentLoading({ label }: { label: string }) {
  return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{label}</div></div>
}

function AuthContentLoading() {
  return <Card><CardContent className="grid min-h-40 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading</div></CardContent></Card>
}

function NotFoundRoute() {
  return <Navigate to="/" replace />
}

function connectedTarget(state: ConnectedDesktopSessionState) {
  if (state.setupRequired) return "/setup"
  if (!state.user) return "/login"
  return authenticatedPath(state.user)
}

function authenticatedPath(user: Pick<User, "mustChangePassword" | "username">) {
  return user.mustChangePassword ? "/change-password" : workspacePath(user.username)
}
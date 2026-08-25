import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { DownloadIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { lazy, Suspense } from "react"

import { useDesktopSession } from "#components/desktop-session"

import { useDesktopUpdater } from "../features/updater/ui/updater-provider"

const DesktopUpdaterSettings = lazy(() => import("../features/updater/ui/update-settings-section").then((module) => ({ default: module.DesktopUpdaterSettings })))

export function PreconnectionUpdater() {
  const { state } = useDesktopSession()
  const updater = useDesktopUpdater()

  if (state.status === "connected") return null

  const busy = updater.stage === "checking" || updater.stage === "preparing-runtime" || updater.stage === "downloading" || updater.stage === "installing"
  const label = updater.stage === "checking" ? "Checking updates" : updater.stage === "preparing-runtime" ? "Preparing update" : updater.stage === "downloading" ? "Downloading update" : updater.stage === "installing" ? "Installing update" : updater.update ? `Update v${updater.update.version}` : "Updates"
  const Icon = busy ? Loader2Icon : updater.update ? DownloadIcon : RefreshCwIcon

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant={updater.update ? "default" : "outline"} size="sm" className="fixed right-4 top-4 z-50 shadow-sm">
          <Icon className={busy ? "animate-spin" : ""} />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>DisCloud updates</DialogTitle>
          <DialogDescription>Check and install signed Desktop updates without connecting to a Remote or Local server first.</DialogDescription>
        </DialogHeader>
        <Suspense fallback={<div className="grid min-h-40 place-items-center text-sm text-muted-foreground"><Loader2Icon className="mr-2 size-4 animate-spin" />Loading updater</div>}>
          <DesktopUpdaterSettings showHeading={false} />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
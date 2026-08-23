import { getCurrentWebview } from "@tauri-apps/api/webview"
import { open } from "@tauri-apps/plugin-dialog"
import { CloudUploadIcon } from "lucide-react"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { errorMessage } from "#lib/instance"

import { FILE_BROWSER_UPLOAD_EVENT } from "../../files/commands"
import { useUploadActions } from "./upload-provider"

type DesktopUploadTargetValue = {
  busy: boolean
  openFiles: () => Promise<void>
  openFolders: () => Promise<void>
}

const DesktopUploadTargetContext = createContext<DesktopUploadTargetValue | null>(null)

export function DesktopFileUploadTarget({
  folderId,
  disabled,
  onError,
  children,
}: {
  folderId: string
  disabled: boolean
  onError?: (message?: string) => void
  children: ReactNode
}) {
  const { addPaths } = useUploadActions()
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const busyRef = useRef(false)

  const enqueuePaths = useCallback(async (paths: readonly string[]) => {
    if (disabled || busyRef.current || !paths.length) return

    busyRef.current = true
    setBusy(true)
    onError?.(undefined)

    try {
      await addPaths(folderId, paths)
    } catch (error) {
      onError?.(errorMessage(error))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [addPaths, disabled, folderId, onError])

  const openFiles = useCallback(async () => {
    if (disabled || busyRef.current) return

    try {
      const selected = await open({
        title: "Upload files",
        directory: false,
        multiple: true,
      })

      await enqueuePaths(normalizeSelection(selected))
    } catch (error) {
      onError?.(errorMessage(error))
    }
  }, [disabled, enqueuePaths, onError])

  const openFolders = useCallback(async () => {
    if (disabled || busyRef.current) return

    try {
      const selected = await open({
        title: "Upload folders",
        directory: true,
        multiple: true,
      })

      await enqueuePaths(normalizeSelection(selected))
    } catch (error) {
      onError?.(errorMessage(error))
    }
  }, [disabled, enqueuePaths, onError])

  useEffect(() => {
    if (disabled) return

    const handleUploadCommand = () => void openFiles()
    window.addEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
    return () => window.removeEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
  }, [disabled, openFiles])

  useEffect(() => {
    if (disabled) {
      setDragActive(false)
      return
    }

    let disposed = false
    let unlisten: (() => void) | undefined

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          if (!busyRef.current) setDragActive(true)
          return
        }

        setDragActive(false)

        if (event.payload.type === "drop" && event.payload.paths.length) {
          void enqueuePaths(event.payload.paths)
        }
      })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch((error) => {
        if (!disposed) onError?.(errorMessage(error))
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [disabled, enqueuePaths, onError])

  const value = useMemo<DesktopUploadTargetValue>(() => ({
    busy,
    openFiles,
    openFolders,
  }), [busy, openFiles, openFolders])

  return (
    <DesktopUploadTargetContext.Provider value={value}>
      {children}

      {dragActive
        ? createPortal(
          <div className="fixed inset-0 z-[100] grid place-items-center bg-background/65 p-6 backdrop-blur-sm">
            <div className="flex min-h-80 w-full max-w-3xl items-center justify-center rounded-3xl border-2 border-dashed border-primary bg-background/95 p-10 shadow-2xl">
              <div className="space-y-5 text-center">
                <div className="mx-auto grid size-20 place-items-center rounded-full bg-primary/10">
                  <CloudUploadIcon className="size-10 -translate-y-1 text-primary" />
                </div>

                <div className="space-y-2">
                  <p className="text-2xl font-semibold">Release to upload</p>
                  <p className="text-sm text-muted-foreground">
                    Files and folders will be uploaded to the current folder.
                  </p>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </DesktopUploadTargetContext.Provider>
  )
}

export function useDesktopFileUploadTarget() {
  const context = useContext(DesktopUploadTargetContext)

  if (!context) {
    throw new Error(
      "useDesktopFileUploadTarget must be used within DesktopFileUploadTarget",
    )
  }

  return context
}

function normalizeSelection(selection: string | string[] | null) {
  if (!selection) return []
  return Array.isArray(selection) ? selection : [selection]
}

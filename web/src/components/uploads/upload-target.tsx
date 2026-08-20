"use client"

import { CloudUploadIcon } from "lucide-react"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useDropzone } from "react-dropzone"

import { useUploads } from "@/components/uploads/upload-provider"
import { FILE_BROWSER_UPLOAD_EVENT } from "@/lib/files/commands"
import { cn } from "@/lib/utils"

type UploadTargetValue = {
  open: () => void
}

const UploadTargetContext = createContext<UploadTargetValue | null>(null)

export function FileUploadTarget({
  folderId,
  disabled,
  children,
}: {
  folderId: string
  disabled: boolean
  children: ReactNode
}) {
  const { addFiles } = useUploads()
  const [dragOverlayActive, setDragOverlayActive] = useState(false)
  const [dropReady, setDropReady] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const isInsidePanel = (clientX: number, clientY: number) => {
    const panel = panelRef.current
    if (!panel) return false

    const rect = panel.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  const { getRootProps, getInputProps, open } = useDropzone({
    disabled,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDragEnter: () => setDragOverlayActive(true),
    onDragOver: (event) => {
      const ready = isInsidePanel(event.clientX, event.clientY)
      setDropReady((current) => current === ready ? current : ready)

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = ready ? "copy" : "none"
      }
    },
    onDragLeave: () => {
      setDragOverlayActive(false)
      setDropReady(false)
    },
    onDrop: (acceptedFiles, _rejections, event) => {
      const accepted =
        !("dataTransfer" in event) ||
        isInsidePanel(event.clientX, event.clientY)

      setDragOverlayActive(false)
      setDropReady(false)

      if (accepted && acceptedFiles.length) addFiles(folderId, acceptedFiles)
    },
  })

  useEffect(() => {
    if (disabled) return

    const handleUploadCommand = () => open()
    window.addEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
    return () => window.removeEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
  }, [disabled, open])

  useEffect(() => {
    if (disabled) {
      setDragOverlayActive(false)
      setDropReady(false)
      return
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return
      event.preventDefault()
      setDragOverlayActive(true)
    }

    const handleDragOver = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return
      event.preventDefault()
    }

    window.addEventListener("dragenter", handleDragEnter, true)
    window.addEventListener("dragover", handleDragOver, true)

    return () => {
      window.removeEventListener("dragenter", handleDragEnter, true)
      window.removeEventListener("dragover", handleDragOver, true)
    }
  }, [disabled])

  return (
    <UploadTargetContext.Provider value={{ open }}>
      <div className="relative">
        <input {...getInputProps()} />
        {children}

        {dragOverlayActive && typeof document !== "undefined" && createPortal(
          <div
            {...getRootProps({
              className: "fixed inset-0 z-[100] grid place-items-center bg-background/65 p-6 backdrop-blur-sm animate-in fade-in duration-150",
            })}
          >
            <div
              ref={panelRef}
              className={cn(
                "relative isolate flex min-h-80 w-full max-w-3xl overflow-hidden rounded-3xl p-[2px] shadow-2xl transition-transform duration-200 ease-out sm:min-h-96",
                dropReady && "scale-[1.015]",
              )}
            >
              {dropReady ? (
                <div className="absolute -inset-[70%] animate-spin bg-[conic-gradient(from_0deg,transparent_0deg,transparent_245deg,var(--primary)_290deg,var(--primary)_315deg,transparent_360deg)] [animation-duration:1.8s]" />
              ) : (
                <div className="absolute inset-0 rounded-3xl border-2 border-dashed border-primary/50" />
              )}

              <div
                className={cn(
                  "relative z-10 flex w-full items-center justify-center rounded-[calc(1.5rem-2px)] bg-background/95 p-10 transition-colors duration-200 sm:p-14",
                  dropReady && "bg-background/90",
                )}
              >
                <div
                  key={dropReady ? "ready" : "idle"}
                  className="animate-in fade-in zoom-in-95 duration-200"
                >
                  <div className="space-y-5 text-center">
                    <div
                      className={cn(
                        "mx-auto grid size-20 place-items-center rounded-full bg-muted transition-[transform,background-color] duration-200",
                        dropReady && "scale-110 bg-primary/10",
                      )}
                    >
                      <CloudUploadIcon
                        className={cn(
                          "size-10 text-muted-foreground transition-[transform,color] duration-200",
                          dropReady && "-translate-y-1 scale-110 text-primary",
                        )}
                      />
                    </div>

                    {dropReady ? (
                      <div className="space-y-2">
                        <p className="text-2xl font-semibold">Release to upload</p>
                        <p className="text-sm text-muted-foreground">
                          Drop now to upload to this folder.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-2xl font-semibold">Move files into the drop zone</p>
                        <p className="text-sm text-muted-foreground">
                          Drag into the highlighted area in the center to upload.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </UploadTargetContext.Provider>
  )
}

export function useUploadTarget() {
  return useContext(UploadTargetContext)
}
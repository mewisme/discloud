"use client"

import { cn } from "@discloud/ui/lib/utils"
import { CloudUploadIcon } from "lucide-react"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useDropzone } from "react-dropzone"

import { useUploadActions } from "@/components/uploads/upload-provider"
import { FILE_BROWSER_UPLOAD_EVENT } from "@/lib/files/commands"

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
  const { addFiles } = useUploadActions()
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

      if (event.dataTransfer) event.dataTransfer.dropEffect = ready ? "copy" : "none"
    },
    onDragLeave: () => {
      setDragOverlayActive(false)
      setDropReady(false)
    },
    onDrop: (acceptedFiles, _rejections, event) => {
      const accepted = !("dataTransfer" in event) || isInsidePanel(event.clientX, event.clientY)

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
              className: "fixed inset-0 z-[100] bg-background/65 backdrop-blur-sm animate-in fade-in duration-150",
            })}
          >
            <div
              ref={panelRef}
              className={cn(
                "absolute left-1/2 top-1/2 flex min-h-80 w-[calc(100vw-3rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl border-2 border-dashed bg-background/95 p-10 shadow-xl transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out sm:min-h-96 sm:p-14",
                dropReady
                  ? "scale-[1.025] border-primary bg-primary/5 shadow-2xl"
                  : "border-primary/50",
              )}
            >
              <div
                key={dropReady ? "ready" : "idle"}
                className="animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="space-y-5 text-center">
                  <div
                    className={cn(
                      "mx-auto grid size-20 place-items-center rounded-full bg-muted transition-[transform,background-color] duration-200",
                      dropReady && "scale-105 bg-primary/10",
                    )}
                  >
                    <CloudUploadIcon
                      className={cn(
                        "size-10 text-muted-foreground transition-[transform,color] duration-200",
                        dropReady && "-translate-y-1 text-primary",
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
"use client"

import { CloudUploadIcon } from "lucide-react"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useDropzone } from "react-dropzone"

import { useUploads } from "@/components/uploads/upload-provider"
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
  const { addFiles } = useUploads()
  const [dragOverlayActive, setDragOverlayActive] = useState(false)
  const { getRootProps, getInputProps, open } = useDropzone({
    disabled,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDragEnter: () => setDragOverlayActive(true),
    onDragOver: () => setDragOverlayActive(true),
    onDragLeave: () => setDragOverlayActive(false),
    onDrop: () => setDragOverlayActive(false),
    onDropAccepted: (files) => addFiles(folderId, files),
  })

  useEffect(() => {
    if (disabled) return

    const handleUploadCommand = () => open()
    window.addEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
    return () => window.removeEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
  }, [disabled, open])

  useEffect(() => {
    if (disabled) setDragOverlayActive(false)
  }, [disabled])

  return (
    <UploadTargetContext.Provider value={{ open }}>
      <div {...getRootProps()} className="relative">
        <input {...getInputProps()} />
        {children}

        {dragOverlayActive && typeof document !== "undefined" && createPortal(
          <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center p-6">
            <div className="absolute inset-0 bg-background/30 backdrop-blur-[2px]" />

            <div
              aria-hidden
              className="relative flex min-h-80 w-[calc(100vw-3rem)] max-w-3xl items-center justify-center rounded-3xl border-2 border-dashed border-primary bg-background/95 p-10 shadow-2xl sm:min-h-96 sm:p-14"
            >
              <div className="space-y-4 text-center">
                <CloudUploadIcon className="mx-auto size-14 text-primary" />

                <div className="space-y-1.5">
                  <p className="text-xl font-semibold">Drop files to upload</p>
                  <p className="text-sm text-muted-foreground">
                    They will be uploaded to this folder.
                  </p>
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
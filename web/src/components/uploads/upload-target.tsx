"use client"

import { CloudUploadIcon } from "lucide-react"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect } from "react"
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
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    disabled,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: (files) => addFiles(folderId, files),
  })

  useEffect(() => {
    if (disabled) return

    const handleUploadCommand = () => open()
    window.addEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
    return () => window.removeEventListener(FILE_BROWSER_UPLOAD_EVENT, handleUploadCommand)
  }, [disabled, open])

  return (
    <UploadTargetContext.Provider value={{ open }}>
      <div {...getRootProps()} className="relative">
        <input {...getInputProps()} />
        {children}

        {isDragActive && typeof document !== "undefined" && createPortal(
          <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center p-4 sm:p-8">
            <div className="pointer-events-none absolute inset-0 bg-background/30 backdrop-blur-[2px]" />

            <div className="pointer-events-none relative flex min-h-80 w-full max-w-3xl items-center justify-center rounded-3xl border-2 border-dashed border-primary bg-background/95 p-10 shadow-2xl sm:min-h-96 sm:p-14">
              <div className="space-y-4 text-center">
                <CloudUploadIcon className="mx-auto size-14 text-primary" />

                <div className="space-y-1.5">
                  <p className="text-lg font-semibold">Drop files to upload</p>
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
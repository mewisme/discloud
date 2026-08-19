"use client"

import type { ReactNode } from "react"
import { createContext, useContext } from "react"
import { CloudUploadIcon } from "lucide-react"
import { useDropzone } from "react-dropzone"
import { useUploads } from "@/components/uploads/upload-provider"

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

  return (
    <UploadTargetContext.Provider value={{ open }}>
      <div {...getRootProps()} className="relative">
        <input {...getInputProps()} />
        {children}
        {isDragActive && (
          <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 backdrop-blur-sm">
            <div className="space-y-2 text-center">
              <CloudUploadIcon className="mx-auto size-10 text-primary" />
              <p className="font-medium">Drop files to upload</p>
              <p className="text-sm text-muted-foreground">They will be uploaded to this folder.</p>
            </div>
          </div>
        )}
      </div>
    </UploadTargetContext.Provider>
  )
}

export function useUploadTarget() {
  return useContext(UploadTargetContext)
}
"use client"

import { CloudUploadIcon } from "lucide-react"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { useDropzone } from "react-dropzone"

import { useUploads } from "@/components/uploads/upload-provider"
import { FILE_BROWSER_UPLOAD_EVENT } from "@/lib/files/commands"

type UploadTargetValue = {
  open: () => void
}

type DropOverlayBounds = {
  top: number
  left: number
  width: number
  height: number
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
  const [overlayBounds, setOverlayBounds] = useState<DropOverlayBounds>()
  const { getRootProps, getInputProps, isDragActive, open, rootRef } = useDropzone({
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

  useEffect(() => {
    if (!isDragActive) {
      setOverlayBounds(undefined)
      return
    }

    const updateOverlayBounds = () => {
      const root = rootRef.current
      if (!root) return

      const rect = root.getBoundingClientRect()
      const top = Math.max(rect.top, 0)
      const left = Math.max(rect.left, 0)
      const right = Math.min(rect.right, window.innerWidth)
      const bottom = Math.min(rect.bottom, window.innerHeight)

      if (right <= left || bottom <= top) {
        setOverlayBounds(undefined)
        return
      }

      setOverlayBounds({
        top,
        left,
        width: right - left,
        height: bottom - top,
      })
    }

    updateOverlayBounds()
    window.addEventListener("resize", updateOverlayBounds)
    window.addEventListener("scroll", updateOverlayBounds, true)

    return () => {
      window.removeEventListener("resize", updateOverlayBounds)
      window.removeEventListener("scroll", updateOverlayBounds, true)
    }
  }, [isDragActive, rootRef])

  return (
    <UploadTargetContext.Provider value={{ open }}>
      <div {...getRootProps()} className="relative">
        <input {...getInputProps()} />
        {children}

        {isDragActive && overlayBounds && (
          <div
            className="pointer-events-none fixed z-40 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 backdrop-blur-sm"
            style={overlayBounds}
          >
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
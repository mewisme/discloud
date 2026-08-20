"use client"

import { CameraIcon, Loader2Icon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { useCurrentUser, useSetCurrentUser } from "@/components/app/current-user-context"
import { CurrentUserAvatar } from "@/components/common/current-user-avatar"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiRequest } from "@/lib/api/client"
import type { AvatarInfo } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

const maxAvatarBytes = 10 * 1024 * 1024
const avatarAccept = "image/jpeg,image/png,image/gif,image/webp"
const avatarTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

export function ProfileAvatarCard() {
  const router = useRouter()
  const user = useCurrentUser()
  const setUser = useSetCurrentUser()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string>()
  const pending = uploading || removing

  async function selectAvatar(file: File) {
    if (file.size > maxAvatarBytes) {
      toast.error("Avatar must be 10 MiB or smaller.")
      return
    }

    if (file.type && !avatarTypes.has(file.type)) {
      toast.error("Choose a JPEG, PNG, GIF or WebP image.")
      return
    }

    setUploading(true)

    try {
      const response = await apiRequest("/me/avatar", {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      const info = await response.json() as AvatarInfo

      setUser((current) => ({
        ...current,
        hasAvatar: info.hasAvatar,
        avatarRevision: info.avatarRevision,
      }))
      toast.success("Avatar updated")
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update avatar."))
    } finally {
      setUploading(false)
    }
  }

  function changeRemoveOpen(next: boolean) {
    if (removing) return
    setRemoveOpen(next)
    if (!next) setRemoveError(undefined)
  }

  async function removeAvatar() {
    if (removing) return

    setRemoving(true)
    setRemoveError(undefined)

    try {
      await apiRequest("/me/avatar", { method: "DELETE" })
      setUser((current) => ({
        ...current,
        hasAvatar: false,
        avatarRevision: current.avatarRevision + 1,
      }))
      setRemoveOpen(false)
      toast.success("Avatar removed")
      router.refresh()
    } catch (error) {
      setRemoveError(apiErrorMessage(error, "Could not remove avatar."))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CameraIcon className="size-4" />
          Profile picture
        </CardTitle>
        <CardDescription>
          Upload a profile picture for your DisCloud account. Images are normalized to a 512 × 512 avatar before storage.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <CurrentUserAvatar className="size-24 text-xl" />

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              JPEG, PNG, GIF or WebP. Maximum upload size: 10 MiB.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={avatarAccept}
          className="sr-only"
          disabled={pending}
          aria-label="Choose profile picture"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            if (file) void selectAvatar(file)
          }}
        />

        <div className="grid gap-2 sm:flex">
          <Button className="w-full sm:w-auto" disabled={pending} onClick={() => inputRef.current?.click()}>
            {uploading ? <Loader2Icon className="animate-spin" /> : <CameraIcon />}
            {uploading ? "Uploading…" : user.hasAvatar ? "Change avatar" : "Upload avatar"}
          </Button>

          {user.hasAvatar && (
            <AlertDialog open={removeOpen} onOpenChange={changeRemoveOpen}>
              <AlertDialogTrigger asChild>
                <Button className="w-full sm:w-auto" variant="outline" disabled={pending}>
                  <Trash2Icon />
                  Remove avatar
                </Button>
              </AlertDialogTrigger>

              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogMedia className="bg-destructive/10 text-destructive">
                    <Trash2Icon />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Remove profile picture?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your current avatar will be removed and DisCloud will fall back to your initials. You can upload another image at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                {removeError && <p role="alert" className="text-sm text-destructive">{removeError}</p>}

                <AlertDialogFooter>
                  <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                  <Button variant="destructive" disabled={removing} onClick={() => void removeAvatar()}>
                    {removing && <Loader2Icon className="animate-spin" />}
                    {removing ? "Removing…" : "Remove avatar"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
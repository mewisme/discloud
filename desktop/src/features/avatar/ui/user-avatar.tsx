import { Avatar, AvatarFallback, AvatarImage } from "@discloud/ui/components/avatar"
import type { ComponentProps } from "react"
import { useEffect, useState } from "react"

import { loadNativeAvatar } from "../core/native"

export type DesktopAvatarIdentity = {
  name: string
  username: string
  hasAvatar: boolean
  avatarRevision: number
}

export function DesktopUserAvatar({
  user,
  adminUserId,
  fallbackClassName,
  ...props
}: Omit<ComponentProps<typeof Avatar>, "children"> & {
  user: DesktopAvatarIdentity
  adminUserId?: string
  fallbackClassName?: string
}) {
  const [src, setSrc] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let objectURL: string | undefined

    setSrc(undefined)

    if (!user.hasAvatar) return

    void loadNativeAvatar(adminUserId)
      .then((payload) => {
        if (!payload || cancelled) return

        objectURL = URL.createObjectURL(new Blob([new Uint8Array(payload.bytes)], { type: payload.contentType }))
        if (!cancelled) setSrc(objectURL)
      })
      .catch(() => {
        if (!cancelled) setSrc(undefined)
      })

    return () => {
      cancelled = true
      if (objectURL) URL.revokeObjectURL(objectURL)
    }
  }, [adminUserId, user.hasAvatar, user.avatarRevision])

  return (
    <Avatar {...props}>
      {src ? <AvatarImage key={src} src={src} alt="" /> : null}
      <AvatarFallback className={fallbackClassName}>{initials(user.name, user.username)}</AvatarFallback>
    </Avatar>
  )
}

function initials(name: string, username: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase()
  return (parts[0]?.slice(0, 2) || username.slice(0, 2) || "DC").toUpperCase()
}
"use client"

import type { ComponentProps } from "react"
import { useCurrentUser } from "@/components/app/current-user-context"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { apiURL } from "@/lib/api/client"
import { initials } from "@/lib/helpers"

export function CurrentUserAvatar(props: Omit<ComponentProps<typeof Avatar>, "children">) {
  const user = useCurrentUser()
  const src = user.hasAvatar
    ? apiURL("/me/avatar", { revision: user.avatarRevision })
    : undefined

  return (
    <Avatar {...props}>
      {src && <AvatarImage key={src} src={src} alt="" />}
      <AvatarFallback>{initials(user.username)}</AvatarFallback>
    </Avatar>
  )
}
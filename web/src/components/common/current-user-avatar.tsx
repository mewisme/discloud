"use client"

import type { ComponentProps } from "react"

import { useCurrentUser } from "@/components/app/current-user-context"
import { UserAvatar } from "@/components/common/user-avatar"
import { Avatar } from "@/components/ui/avatar"
import { apiURL } from "@/lib/api/client"

export function CurrentUserAvatar(props: Omit<ComponentProps<typeof Avatar>, "children">) {
  const user = useCurrentUser()
  const src = user.hasAvatar ? apiURL("/me/avatar", { revision: user.avatarRevision }) : undefined

  return <UserAvatar {...props} name={user.name} username={user.username} src={src} />
}
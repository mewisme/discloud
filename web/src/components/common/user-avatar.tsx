"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@discloud/ui/components/avatar"
import type { ComponentProps } from "react"

import { initials } from "@/lib/helpers"

export function UserAvatar({
  name,
  username,
  src,
  ...props
}: Omit<ComponentProps<typeof Avatar>, "children"> & {
  name: string
  username: string
  src?: string
}) {
  return (
    <Avatar {...props}>
      {src && <AvatarImage key={src} src={src} alt="" />}
      <AvatarFallback>{initials(name || username)}</AvatarFallback>
    </Avatar>
  )
}
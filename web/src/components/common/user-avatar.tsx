"use client"

import type { ComponentProps } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
"use client"

import { Loader2Icon, UploadIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useCurrentUser } from "@/components/app/current-user-context"
import { Button } from "@/components/ui/button"
import { useUploads } from "@/components/uploads/upload-provider"
import { isActiveUploadTask } from "@/components/uploads/upload-task"
import { workspacePath } from "@/lib/workspace/navigation"

export function UploadManagerButton() {
  const pathname = usePathname()
  const currentUser = useCurrentUser()
  const { tasks } = useUploads()

  if (!tasks.length) return null

  const href = workspacePath(currentUser.username, "uploads")
  if (pathname === href || pathname === `${href}/`) return null

  const active = tasks.filter(isActiveUploadTask).length
  const failed = tasks.filter((task) => task.status === "error").length

  return (
    <Button asChild className="fixed bottom-4 right-4 z-40 shadow-lg">
      <Link href={href}>
        {active > 0 ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        Uploads

        {(active > 0 || failed > 0) && (
          <span className="text-xs opacity-80">
            ({active} active{failed > 0 ? ` · ${failed} failed` : ""})
          </span>
        )}
      </Link>
    </Button>
  )
}
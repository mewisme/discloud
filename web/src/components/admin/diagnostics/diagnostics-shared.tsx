"use client"

import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { AlertCircleIcon, BracesIcon } from "lucide-react"

export const DIAGNOSTICS_PAGE_SIZE = 25

export function JSONDialog({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: unknown
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`View details for ${title}`}>
          <BracesIcon />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const unhealthy = status === "failed"
    || status === "dead"
    || status === "expired"
    || status === "cancelled"

  return (
    <Badge
      variant={
        unhealthy
          ? "destructive"
          : status === "running" || status === "completing"
            ? "secondary"
            : "outline"
      }
      className="capitalize"
    >
      {unhealthy && <AlertCircleIcon />}
      {status}
    </Badge>
  )
}
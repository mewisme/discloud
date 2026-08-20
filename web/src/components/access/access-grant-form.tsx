"use client"

import { Loader2Icon, UserPlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AccessLevel } from "@/lib/api/models"

export function AccessGrantForm({
  username,
  level,
  mutating,
  adding,
  onUsernameChange,
  onLevelChange,
  onAdd,
}: {
  username: string
  level: AccessLevel
  mutating: boolean
  adding: boolean
  onUsernameChange: (username: string) => void
  onLevelChange: (level: AccessLevel) => void
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        value={username}
        autoFocus
        placeholder="Exact username"
        disabled={mutating}
        onChange={(event) => onUsernameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onAdd()
          }
        }}
      />

      <Select value={level} disabled={mutating} onValueChange={(value) => onLevelChange(value as AccessLevel)}>
        <SelectTrigger className="sm:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="view">View</SelectItem>
          <SelectItem value="edit">Edit</SelectItem>
          <SelectItem value="full">Full</SelectItem>
        </SelectContent>
      </Select>

      <Button disabled={mutating || !username.trim()} onClick={onAdd}>
        {adding ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />}
        {adding ? "Adding…" : "Add"}
      </Button>
    </div>
  )
}
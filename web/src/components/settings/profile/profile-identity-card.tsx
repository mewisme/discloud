"use client"

import { Loader2Icon, SaveIcon, UserRoundIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { useCurrentUser, useSetCurrentUser } from "@/components/app/current-user-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { apiJSON } from "@/lib/api/client"
import type { UpdateMeInput, User } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export function ProfileIdentityCard() {
  const router = useRouter()
  const user = useCurrentUser()
  const setUser = useSetCurrentUser()
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)

  async function save() {
    const nextName = name.trim()

    if (!nextName) {
      toast.error("Name is required")
      return
    }

    if (Array.from(nextName).length > 100) {
      toast.error("Name must be at most 100 characters")
      return
    }

    if (nextName === user.name) return

    setSaving(true)

    try {
      const input = { name: nextName } satisfies UpdateMeInput
      const updated = await apiJSON<User>("/me", {
        method: "PATCH",
        body: input,
      })

      setUser(updated)
      setName(updated.name)
      toast.success("Name updated")
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update your name."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRoundIcon className="size-4" />
          Profile
        </CardTitle>
        <CardDescription>Manage how your account is displayed in DisCloud.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <Field>
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="profile-name"
              autoComplete="name"
              maxLength={100}
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
            <Button className="sm:w-auto" disabled={saving || name.trim() === user.name} onClick={() => void save()}>
              {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <FieldDescription>This is your display name and can be changed at any time.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="profile-username">Username</FieldLabel>
          <Input id="profile-username" value={user.username} disabled readOnly />
          <FieldDescription>
            Username is permanent. It is used to sign in and identify your workspace at /{user.username}.
          </FieldDescription>
        </Field>
      </CardContent>
    </Card>
  )
}
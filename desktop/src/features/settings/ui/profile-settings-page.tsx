import type { AvatarInfo, UpdateMeInput, User } from "@discloud/api/models"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Input } from "@discloud/ui/components/input"
import { open } from "@tauri-apps/plugin-dialog"
import { CameraIcon, Loader2Icon, SaveIcon, Trash2Icon, TriangleAlertIcon, UserRoundIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { useDesktopSession } from "#components/desktop-session"
import { errorMessage } from "#lib/instance"

import { loadNativeAvatar, removeAvatar, updateNativeAvatar, updateProfile } from "../core/profile"

export function DesktopProfileSettingsPage() {
  const { state, setAuthenticated } = useDesktopSession()
  if (state.status !== "connected" || !state.user) return null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your profile picture and account identity.</p>
      </div>

      <ProfileIdentityCard user={state.user} onUpdated={setAuthenticated} />
      <ProfileAvatarCard user={state.user} onUpdated={setAuthenticated} />
    </div>
  )
}

function ProfileIdentityCard({ user, onUpdated }: { user: User; onUpdated: (user: User) => void }) {
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => setName(user.name), [user.name])

  async function save() {
    const nextName = name.trim()

    if (!nextName) {
      setError("Name is required.")
      return
    }

    if (Array.from(nextName).length > 100) {
      setError("Name must be at most 100 characters.")
      return
    }

    if (nextName === user.name || saving) return

    setSaving(true)
    setError(undefined)

    try {
      const input = { name: nextName } satisfies UpdateMeInput
      const updated = await updateProfile(input)
      onUpdated(updated)
      setName(updated.name)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserRoundIcon className="size-4" />Profile</CardTitle>
        <CardDescription>Manage how your account is displayed in DisCloud.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? <InlineError message={error} /> : null}

        <div className="space-y-2">
          <label htmlFor="profile-name" className="text-sm font-medium">Name</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="profile-name" autoComplete="name" maxLength={100} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
            <Button className="sm:w-auto" disabled={saving || !name.trim() || name.trim() === user.name} onClick={() => void save()}>
              {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">This is your display name and can be changed at any time.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="profile-username" className="text-sm font-medium">Username</label>
          <Input id="profile-username" value={user.username} disabled readOnly />
          <p className="text-sm text-muted-foreground">Username is permanent and identifies your workspace at /{user.username}.</p>
        </div>
      </CardContent>
    </Card>
  )
}

function ProfileAvatarCard({ user, onUpdated }: { user: User; onUpdated: (user: User) => void }) {
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string>()
  const pending = uploading || removing

  async function chooseAvatar() {
    if (pending) return

    try {
      const selected = await open({
        title: "Choose profile picture",
        directory: false,
        multiple: false,
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }],
      })

      if (!selected) return

      setUploading(true)
      setError(undefined)

      const info = await updateNativeAvatar(selected)
      onUpdated(withAvatarInfo(user, info))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setUploading(false)
    }
  }

  async function remove() {
    if (pending || !user.hasAvatar) return

    setRemoving(true)
    setError(undefined)

    try {
      await removeAvatar()
      onUpdated({ ...user, hasAvatar: false, avatarRevision: user.avatarRevision + 1 })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CameraIcon className="size-4" />Profile picture</CardTitle>
        <CardDescription>Images are normalized to a 512 x 512 avatar before storage.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? <InlineError message={error} /> : null}

        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <DesktopAvatar user={user} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
            <p className="mt-1 text-sm text-muted-foreground">JPEG, PNG, GIF or WebP. Maximum upload size: 10 MiB.</p>
          </div>
        </div>

        <div className="grid gap-2 sm:flex">
          <Button className="w-full sm:w-auto" disabled={pending} onClick={() => void chooseAvatar()}>
            {uploading ? <Loader2Icon className="animate-spin" /> : <CameraIcon />}
            {uploading ? "Uploading..." : user.hasAvatar ? "Change avatar" : "Upload avatar"}
          </Button>

          {user.hasAvatar ? (
            <Button className="w-full sm:w-auto" variant="outline" disabled={pending} onClick={() => void remove()}>
              {removing ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              {removing ? "Removing..." : "Remove avatar"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function DesktopAvatar({ user }: { user: User }) {
  const [url, setURL] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let objectURL: string | undefined

    async function load() {
      if (!user.hasAvatar) {
        setURL(undefined)
        return
      }

      try {
        const payload = await loadNativeAvatar()
        if (!payload || cancelled) return

        objectURL = URL.createObjectURL(new Blob([new Uint8Array(payload.bytes)], { type: payload.contentType }))
        if (!cancelled) setURL(objectURL)
      } catch {
        if (!cancelled) setURL(undefined)
      }
    }

    void load()

    return () => {
      cancelled = true
      if (objectURL) URL.revokeObjectURL(objectURL)
    }
  }, [user.hasAvatar, user.avatarRevision])

  if (url) return <img src={url} alt="" className="size-24 shrink-0 rounded-full border object-cover" />

  return (
    <div className="grid size-24 shrink-0 place-items-center rounded-full border bg-muted text-xl font-semibold">
      {initials(user.name, user.username)}
    </div>
  )
}

function withAvatarInfo(user: User, info: AvatarInfo): User {
  return { ...user, hasAvatar: info.hasAvatar, avatarRevision: info.avatarRevision }
}

function initials(name: string, username: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase()
  return (parts[0]?.slice(0, 2) || username.slice(0, 2) || "DC").toUpperCase()
}

function InlineError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Profile action failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

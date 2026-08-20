import { ProfileAvatarCard } from "@/components/settings/profile/profile-avatar-card"
import { ProfileIdentityCard } from "@/components/settings/profile/profile-identity-card"

export function ProfileSettings() {
  return (
    <div className="space-y-6">
      <ProfileIdentityCard />
      <ProfileAvatarCard />
    </div>
  )
}
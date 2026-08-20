import { PublicCollectionView } from "@/components/shares/public/public-collection-view"
import { PublicFileView } from "@/components/shares/public/public-file-view"
import { PublicFolderView } from "@/components/shares/public/public-folder-view"
import { PublicShareShell, UnavailablePublicShare } from "@/components/shares/public/public-share-shell"
import type { PublicShare } from "@/lib/api/models"

export function PublicShareView({ share }: { share: PublicShare }) {
  return (
    <PublicShareShell>
      {share.resourceType === "file" && share.file ? (
        <PublicFileView publicId={share.publicId} file={share.file} />
      ) : share.resourceType === "folder" && share.folder ? (
        <PublicFolderView publicId={share.publicId} root={share.folder} />
      ) : share.resourceType === "collection" && share.collection ? (
        <PublicCollectionView
          publicId={share.publicId}
          collection={share.collection}
        />
      ) : (
        <UnavailablePublicShare />
      )}
    </PublicShareShell>
  )
}
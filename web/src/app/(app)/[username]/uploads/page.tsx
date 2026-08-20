import type { Metadata } from "next"

import { UploadManagerPage } from "@/components/uploads/upload-manager"

export const metadata: Metadata = {
  title: "Uploads",
}

export default function UploadsPage() {
  return <UploadManagerPage />
}
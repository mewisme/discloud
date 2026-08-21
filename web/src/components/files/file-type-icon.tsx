import { FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon } from "lucide-react"
import { type ComponentProps, useMemo } from "react"

export function FileTypeIcon({
  category,
  ...props
}: {
  category?: string
} & ComponentProps<typeof FileIcon>) {
  const Icon = useMemo(() => fileTypeIcon(category), [category])
  return <Icon {...props} />
}

function fileTypeIcon(category?: string) {
  switch (category) {
    case "image":
      return FileImageIcon
    case "video":
      return FileVideoIcon
    case "audio":
      return FileAudioIcon
    case "document":
    case "text":
      return FileTextIcon
    case "archive":
      return FileArchiveIcon
    default:
      return FileIcon
  }
}
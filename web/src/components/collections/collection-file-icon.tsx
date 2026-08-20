import { FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon } from "lucide-react"

export function CollectionFileIcon({ category }: { category?: string }) {
  switch (category) {
    case "image":
      return <FileImageIcon className="size-4 shrink-0" />
    case "video":
      return <FileVideoIcon className="size-4 shrink-0" />
    case "audio":
      return <FileAudioIcon className="size-4 shrink-0" />
    case "document":
    case "text":
      return <FileTextIcon className="size-4 shrink-0" />
    case "archive":
      return <FileArchiveIcon className="size-4 shrink-0" />
    default:
      return <FileIcon className="size-4 shrink-0" />
  }
}
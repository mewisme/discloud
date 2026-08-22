import type { BrowserNode } from "@discloud/api/models"
import { cn } from "@discloud/ui/lib/utils"
import { FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon } from "lucide-react"
import type { ComponentProps } from "react"

export function FileTypeIcon({ category, ...props }: { category?: string } & ComponentProps<typeof FileIcon>) {
  const Icon = fileTypeIcon(category)
  return <Icon {...props} />
}

export function FileNodeVisual({ node, className, iconClassName = "size-4" }: { node: BrowserNode; className?: string; iconClassName?: string }) {
  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted", className)}>
      {node.kind === "folder"
        ? <FolderIcon className={cn("text-muted-foreground", iconClassName)} aria-hidden />
        : <FileTypeIcon category={node.category} className={cn("text-muted-foreground", iconClassName)} aria-hidden />}
    </div>
  )
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
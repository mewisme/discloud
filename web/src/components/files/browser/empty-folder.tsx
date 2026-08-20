import { FolderOpenIcon } from "lucide-react"

export function EmptyFolder() {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-2">
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-muted">
          <FolderOpenIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">Empty folder</p>
          <p className="text-sm text-muted-foreground">Drop files here or create a folder.</p>
        </div>
      </div>
    </div>
  )
}
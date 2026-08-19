import { Skeleton } from "@/components/ui/skeleton"

export default function FilesLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <Skeleton className="h-5 w-56" />
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="overflow-hidden rounded-xl border">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex h-12 items-center gap-3 border-b px-3 last:border-b-0">
            <Skeleton className="size-5" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto hidden h-4 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
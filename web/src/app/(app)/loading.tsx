import { Skeleton } from "@discloud/ui/components/skeleton"

export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="mt-2 grid gap-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  )
}
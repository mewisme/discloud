import { Skeleton } from "@discloud/ui/components/skeleton"

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 p-6">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-5 w-72" />
      <Skeleton className="mt-4 h-64 w-full" />
    </main>
  )
}
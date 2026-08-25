import { cn } from "@discloud/ui/lib/utils"

export function AppIcon({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block shrink-0 bg-contain bg-center bg-no-repeat", className)} style={{ backgroundImage: "url('/app-icon.png')" }} />
}

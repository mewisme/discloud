import { Card, CardContent, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { DatabaseIcon, FileIcon, HardDriveIcon, UsersIcon } from "lucide-react"
import type { ReactNode } from "react"

import type { StorageOverview } from "@/lib/api/models"
import { formatBytes, formatNumber } from "@/lib/helpers"

export function StorageOverviewCards({ storage }: { storage: StorageOverview }) {
  const logicalMismatch = storage.derivedLogicalUsedBytes !== storage.cachedLogicalUsedBytes
  const reservedMismatch = storage.derivedReservedBytes !== storage.cachedReservedBytes

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        icon={<UsersIcon />}
        label="Users"
        value={formatNumber(storage.userCount)}
        detail={`${formatNumber(storage.activeFileCount)} active files`}
      />

      <MetricCard
        icon={<HardDriveIcon />}
        label="Logical storage"
        value={formatBytes(storage.derivedLogicalUsedBytes)}
        detail={logicalMismatch ? `Cached ${formatBytes(storage.cachedLogicalUsedBytes)} · mismatch` : "Quota cache matches"}
        warning={logicalMismatch}
      />

      <MetricCard
        icon={<DatabaseIcon />}
        label="Unique chunks"
        value={formatBytes(storage.uniqueChunkBytes)}
        detail={`${formatNumber(storage.uniqueChunkCount)} chunks · ${formatNumber(storage.readyChunkCount)} ready`}
      />

      <MetricCard
        icon={<FileIcon />}
        label="Reserved"
        value={formatBytes(storage.derivedReservedBytes)}
        detail={
          reservedMismatch || storage.quotaMismatchUsers > 0
            ? `${formatNumber(storage.quotaMismatchUsers)} quota mismatch users`
            : `${formatBytes(storage.orphanCandidateChunkBytes)} orphan candidates`
        }
        warning={reservedMismatch || storage.quotaMismatchUsers > 0}
      />
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  warning = false,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  warning?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <div className={warning ? "text-destructive [&>svg]:size-4" : "text-muted-foreground [&>svg]:size-4"}>
          {icon}
        </div>
      </CardHeader>

      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <p className={warning ? "mt-1 text-xs text-destructive" : "mt-1 text-xs text-muted-foreground"}>
          {detail}
        </p>
      </CardContent>
    </Card>
  )
}
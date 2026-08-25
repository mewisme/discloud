"use client"

import type { UserConfig } from "@discloud/api/models"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { ListIcon } from "lucide-react"
import { SettingsRow } from "./settings-row"

type CommonConfig = UserConfig["common"]
export type PaginationMode = CommonConfig["pagination"]["mode"]

export function PaginationSettings({ mode, onModeChange }: { mode: PaginationMode; onModeChange: (mode: PaginationMode) => void }) {
  return (
    <Card id="pagination" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListIcon className="size-4" />Pagination</CardTitle>
        <CardDescription>Choose how DisCloud loads additional items in paginated lists.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow title="Loading behavior" description="Applies to all paginated lists across DisCloud." last>
          <div className="space-y-3">
            <Select value={mode} onValueChange={(value) => { if (value === "infinite" || value === "manual") onModeChange(value) }}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Pagination loading behavior"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectLabel>Loading behavior</SelectLabel><SelectItem value="infinite">Infinite scroll</SelectItem><SelectItem value="manual">Load more button</SelectItem></SelectGroup></SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">Infinite scroll automatically loads the next page near the end of the list. Manual mode waits for you to press Load more.</p>
          </div>
        </SettingsRow>
      </CardContent>
    </Card>
  )
}

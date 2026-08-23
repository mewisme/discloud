"use client"

import { Input } from "@discloud/ui/components/input"
import { SearchIcon } from "lucide-react"
import { useEffect, useState } from "react"

export function SearchInput({
  initialValue,
  onChange,
}: {
  initialValue: string
  onChange: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (value.trim() === initialValue) return

    const timeout = setTimeout(() => onChange(value.trim()), 300)
    return () => clearTimeout(timeout)
  }, [initialValue, onChange, value])

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        maxLength={256}
        autoFocus
        aria-label="Search files and folders"
        placeholder="Search files and folders…"
        className="h-11 pl-9"
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  )
}
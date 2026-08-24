"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import type { ComponentProps } from "react"
import { useEffect, useRef, useState } from "react"
import { Button } from "#components/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/tooltip"

type CopyValue = string | number | (() => string | number | Promise<string | number>)

type CopyButtonProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  value: CopyValue
  label: string
  copiedLabel?: string
  resetAfter?: number
  onCopyError?: (error: unknown) => void
}

function CopyButton({ value, label, copiedLabel = "Copied", resetAfter = 1500, onCopyError, children, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  async function copy() {
    try {
      const text = String(typeof value === "function" ? await value() : value)
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), resetAfter)
    } catch (error) {
      setCopied(false)
      onCopyError?.(error)
    }
  }

  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen || copied} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <Button {...props} aria-label={props["aria-label"] ?? label} onClick={() => void copy()}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? copiedLabel : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { CopyButton }

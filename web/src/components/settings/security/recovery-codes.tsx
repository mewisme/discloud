import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { CopyButton } from "@discloud/ui/components/copy-button"
import { CheckIcon, DownloadIcon, KeyRoundIcon } from "lucide-react"

export function RecoveryCodes({
  codes,
  onCopyError,
  onDownload,
  onDismiss,
}: {
  codes: readonly string[]
  onCopyError: (error: unknown) => void
  onDownload: () => void
  onDismiss: () => void
}) {
  return (
    <Alert>
      <KeyRoundIcon />
      <AlertTitle>Save your recovery codes now</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>Each code can be used once. DisCloud will not show this set again after you dismiss it.</p>

        <div className="grid gap-1 rounded-lg border bg-muted/50 p-3 font-mono text-xs sm:grid-cols-2">
          {codes.map((code) => <code key={code}>{code}</code>)}
        </div>

        <div className="flex flex-wrap gap-2">
          <CopyButton value={codes.join("\n")} label="Copy recovery codes" type="button" size="sm" variant="outline" onCopyError={onCopyError}>Copy</CopyButton>
          <Button type="button" size="sm" variant="outline" onClick={onDownload}>
            <DownloadIcon />
            Download
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            <CheckIcon />
            I saved them
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
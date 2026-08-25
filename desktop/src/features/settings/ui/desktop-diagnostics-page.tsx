import { DesktopDiagnosticsSettings } from "./desktop-diagnostics-settings"

export function DesktopDiagnosticsPage() {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Diagnostics</h2>
        <p className="text-sm text-muted-foreground">Inspect, export and clear native desktop logs for this device.</p>
      </div>
      <DesktopDiagnosticsSettings />
    </section>
  )
}

export function App() {
  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 p-6 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <section className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              DisCloud
            </p>

            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              Desktop foundation
            </h1>
          </div>

          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Ready
          </span>
        </div>

        <p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
          Tauri v2, React 19, Vite and Tailwind CSS are ready.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
          <FoundationItem label="Runtime" value="Tauri v2" />
          <FoundationItem label="UI" value="React 19" />
          <FoundationItem label="Bundler" value="Vite" />
          <FoundationItem label="Styles" value="Tailwind 4" />
        </div>
      </section>
    </main>
  )
}

function FoundationItem({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
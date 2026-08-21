export const dynamic = "force-dynamic"

export function GET() {
  const apiURL = process.env.DISCLOUD_PUBLIC_API_URL?.trim() ?? ""
  const body = `globalThis.__DISCLOUD_CONFIG__=${JSON.stringify({ apiURL })};`

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/javascript; charset=utf-8",
    },
  })
}
import type { BrowserNode } from "@/lib/api/models"

export async function runNodeOperations(
  nodes: readonly BrowserNode[],
  operation: (node: BrowserNode) => Promise<unknown>,
) {
  const successful: string[] = []
  const errors: unknown[] = []

  for (let index = 0; index < nodes.length; index += 8) {
    const batch = nodes.slice(index, index + 8)
    const results = await Promise.allSettled(batch.map(operation))

    results.forEach((result, offset) => {
      if (result.status === "fulfilled") successful.push(batch[offset].id)
      else errors.push(result.reason)
    })
  }

  return { successful, errors }
}
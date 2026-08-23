import { describe, expect, it } from "vitest"

import { contextMenuTargets } from "./context-menu-targets"

type Item = { id: string; name: string }

const first: Item = { id: "first", name: "First" }
const second: Item = { id: "second", name: "Second" }
const third: Item = { id: "third", name: "Third" }

describe("contextMenuTargets", () => {
  it("uses the current selection when the clicked node is selected", () => {
    const selectedNodes = [first, second]
    expect(contextMenuTargets(first, new Set([first.id, second.id]), selectedNodes)).toBe(selectedNodes)
  })

  it("uses only the clicked node when it is outside the current selection", () => {
    expect(contextMenuTargets(third, new Set([first.id, second.id]), [first, second])).toEqual([third])
  })

  it("falls back to the clicked node when the selection projection is empty", () => {
    expect(contextMenuTargets(first, new Set([first.id]), [])).toEqual([first])
  })
})

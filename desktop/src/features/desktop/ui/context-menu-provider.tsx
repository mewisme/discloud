import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@discloud/ui/components/context-menu"
import { ArrowLeftIcon, ArrowRightIcon, ClipboardIcon, ClipboardPasteIcon, CopyIcon, Redo2Icon,RotateCwIcon, ScissorsIcon, TextSelectIcon, Undo2Icon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement

export function DesktopContextMenuProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const editable = editableTarget(target)
  const selection = selectedText(editable)
  const link = target?.closest<HTMLAnchorElement>("a[href]") ?? null
  const hasContextActions = !!editable || !!selection || !!link

  useEffect(() => {
    function disableNativeContextMenu(event: MouseEvent) {
      event.preventDefault()
    }

    document.addEventListener("contextmenu", disableNativeContextMenu)
    return () => document.removeEventListener("contextmenu", disableNativeContextMenu)
  }, [])

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents" onContextMenu={(event) => setTarget(event.target instanceof HTMLElement ? event.target : null)}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {editable ? (
          <>
            <ContextMenuItem onSelect={() => editCommand(editable, "undo")}><Undo2Icon />Undo</ContextMenuItem>
            <ContextMenuItem onSelect={() => editCommand(editable, "redo")}><Redo2Icon />Redo</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!selection || isPasswordInput(editable)} onSelect={() => void cutSelection(editable)}><ScissorsIcon />Cut</ContextMenuItem>
            <ContextMenuItem disabled={!selection || isPasswordInput(editable)} onSelect={() => void copySelection(editable)}><CopyIcon />Copy</ContextMenuItem>
            <ContextMenuItem disabled={!navigator.clipboard?.readText} onSelect={() => void pasteSelection(editable)}><ClipboardPasteIcon />Paste</ContextMenuItem>
            <ContextMenuItem onSelect={() => selectAll(editable)}><TextSelectIcon />Select all</ContextMenuItem>
          </>
        ) : selection ? <ContextMenuItem onSelect={() => void writeClipboard(selection)}><CopyIcon />Copy</ContextMenuItem> : null}

        {link ? <ContextMenuItem onSelect={() => void writeClipboard(link.href)}><ClipboardIcon />Copy link</ContextMenuItem> : null}
        {hasContextActions ? <ContextMenuSeparator /> : null}

        <ContextMenuItem onSelect={() => window.history.back()}><ArrowLeftIcon />Back<ContextMenuShortcut>Alt+Left</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => window.history.forward()}><ArrowRightIcon />Forward<ContextMenuShortcut>Alt+Right</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => window.location.reload()}><RotateCwIcon />Reload<ContextMenuShortcut>Ctrl+R</ContextMenuShortcut></ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function editableTarget(target: HTMLElement | null): EditableTarget | null {
  if (!target) return null
  const element = target.closest<HTMLElement>("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")
  if (!element || element instanceof HTMLInputElement && !textInput(element)) return null
  return element
}

function textInput(input: HTMLInputElement) {
  return ["", "text", "search", "url", "tel", "email", "password"].includes(input.type)
}

function isPasswordInput(target: EditableTarget) {
  return target instanceof HTMLInputElement && target.type === "password"
}

function selectedText(target: EditableTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0
    const end = target.selectionEnd ?? start
    return target.value.slice(start, end)
  }
  return window.getSelection()?.toString() ?? ""
}

function editCommand(target: EditableTarget, command: "undo" | "redo") {
  target.focus()
  document.execCommand(command)
}

async function copySelection(target: EditableTarget) {
  if (isPasswordInput(target)) return
  const text = selectedText(target)
  if (text) await writeClipboard(text)
}

async function cutSelection(target: EditableTarget) {
  if (isPasswordInput(target)) return
  const text = selectedText(target)
  if (!text) return
  await writeClipboard(text)
  replaceSelection(target, "")
}

async function pasteSelection(target: EditableTarget) {
  if (!navigator.clipboard?.readText) return
  try {
    replaceSelection(target, await navigator.clipboard.readText())
  } catch {
    target.focus()
  }
}

function replaceSelection(target: EditableTarget, value: string) {
  target.focus()
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? start
    const next = `${target.value.slice(0, start)}${value}${target.value.slice(end)}`
    const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, next)
    target.setSelectionRange(start + value.length, start + value.length)
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
    return
  }
  document.execCommand("insertText", false, value)
}

function selectAll(target: EditableTarget) {
  target.focus()
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.select()
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(target)
  selection.removeAllRanges()
  selection.addRange(range)
}

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const input = document.createElement("textarea")
    input.value = value
    input.style.position = "fixed"
    input.style.opacity = "0"
    document.body.appendChild(input)
    input.select()
    document.execCommand("copy")
    input.remove()
  }
}

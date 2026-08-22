const interactiveSelector = "a,button,input,select,textarea,[role=button],[role=checkbox],[role=menuitem],[contenteditable=true]"

type NavigationMouseEvent = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  preventDefault: () => void
}

export function handleClientNavigation(event: NavigationMouseEvent, navigate: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  event.preventDefault()
  navigate()
  return true
}

export function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(interactiveSelector)
}
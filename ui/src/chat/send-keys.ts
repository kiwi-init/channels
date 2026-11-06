export type SendKey = {
  key: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  keyCode: number
  nativeEvent: { isComposing: boolean }
}

export const composing = (e: SendKey): boolean => e.nativeEvent.isComposing || e.keyCode === 229

export const sendsOn = (e: SendKey, enterSends: boolean): boolean => !composing(e) && e.key === "Enter" && (enterSends ? !e.shiftKey && !e.altKey : e.metaKey || e.ctrlKey)

export const sendTitle = (enterSends: boolean): string => (enterSends ? "Send (Enter)" : "Send (⌘ Enter)")

import { createContext, useSyncExternalStore } from "react"

export type EditAt = "main" | "panel" | ""

export const EditHere = createContext<EditAt>("")

let editing: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f))

export function startEditing(code: string, seq: number, at: EditAt = ""): void {
  editing = `${at}:${code}:${seq}`
  emit()
}

let deleting: string | null = null

export function askDelete(code: string, seq: number): void {
  deleting = `${code}:${seq}`
  emit()
}

export function stopAskingDelete(): void {
  deleting = null
  emit()
}

export const useAskingDelete = (code: string, seq: number): boolean => useSyncExternalStore(subscribe, () => deleting === `${code}:${seq}`)

export function stopEditing(): void {
  editing = null
  emit()
}

export const useEditing = (code: string, seq: number): boolean => useSyncExternalStore(subscribe, () => editing === `:${code}:${seq}`)

export const useEditingIn = (code: string, at: EditAt): number | null =>
  useSyncExternalStore(subscribe, () => (at && editing?.startsWith(`${at}:${code}:`) ? Number(editing.slice(at.length + code.length + 2)) : null))

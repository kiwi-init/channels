import type { UiCommand } from "../../../desktop/src/ui-command.ts"

type Listener = (command: UiCommand) => void

const TWICE_MS = 250
const listeners = new Set<Listener>()
let keyed: { command: UiCommand; at: number } | null = null

export function keyRan(command: UiCommand, now: number = Date.now()): void {
  keyed = { command, at: now }
}

export function runCommand(command: UiCommand, now: number = Date.now()): void {
  if (keyed && keyed.command === command && now - keyed.at < TWICE_MS) return
  for (const l of [...listeners]) l(command)
}

export function onCommand(l: Listener): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const channelOf = (command: UiCommand): number | null => {
  const n = /^channel-([1-9])$/.exec(command)?.[1]
  return n ? Number(n) : null
}

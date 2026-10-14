// Your computers: the ones paired with this app (kiwi pair), kept in the bridge's secrets store.
// Pairing runs in the main process over the relay's pairing mailbox (window.kiwi.pairBegin/Poll/
// Answer): the app shows a kp1- code, the computer runs `kiwi pair <code>`, and the person confirms
// what asked. Removing one forgets it and takes its agents out of every channel this app owns.

import { Channel } from "@mc/client.ts"

import { allMembers, saveMember } from "./channel"
import { relayUrl } from "./relay"
import { bridge, saveComputers, secrets, type ComputerView, type PairAskView } from "./secrets"

export type { ComputerView, PairAskView }

/** What to paste on the computer to pair it: install-and-pair, or pair with kiwi already there. */
export function pairCommands(code: string): { install: string; pair: string } {
  return { install: `curl -fsSL ${relayUrl()}/install | sh -s -- pair ${code}`, pair: `kiwi pair ${code}` }
}

/**
 * The app's own computer: the daemon it runs, certified by this person, so agents on this machine
 * come in as theirs (and are let in on their own) like any paired computer's. Nothing else adds it:
 * the app does this once a person exists, and again only while it's missing. Null outside the app.
 */
export async function adoptThisComputer(): Promise<ComputerView | null> {
  const b = bridge()
  if (!b || !secrets().person || secrets().computers.some((c) => c.own)) return null
  return b.daemonAdopt()
}

/** Raised outside the desktop app: pairing runs in its main process. */
export class PairingNeedsApp extends Error {
  constructor() {
    super("Pairing a computer needs the Kiwi desktop app.")
  }
}

export interface Pairing {
  code: string
  /** Wait for a computer to ask (polls the mailbox); null when it was cancelled. */
  next: (signal: AbortSignal) => Promise<PairAskView | null>
  answer: (accept: boolean) => Promise<{ machinePk: string } | null>
  cancel: () => Promise<void>
}

/** Open the pairing mailbox: a code to show, then the computer that asks on it. */
export async function beginPairing(): Promise<Pairing> {
  const b = bridge()
  if (!b) throw new PairingNeedsApp()
  const { code } = await b.pairBegin()
  return {
    code,
    next: async (signal) => {
      while (!signal.aborted) {
        const ask = await b.pairPoll()
        if (ask) return ask
        await new Promise((r) => setTimeout(r, 1500))
      }
      return null
    },
    answer: (accept) => b.pairAnswer(accept),
    cancel: () => b.pairCancel(),
  }
}

/** The channels this app owns, opened as their owner. */
function owned(): Channel[] {
  return allMembers()
    .filter((m) => m.identity.pk === m.access.ownerPk)
    .map((m) => new Channel(m.access, relayUrl(), m.identity, (access) => saveMember({ ...m, access })))
}

/** Take every agent that computer let in out of the channels this app owns; returns their names. */
export async function removeAgentsOf(machinePk: string): Promise<string[]> {
  const removed: string[] = []
  for (const ch of owned()) {
    const members = await ch.members().catch(() => [])
    for (const m of members) {
      if (m.from?.pk !== machinePk) continue
      await ch
        .remove(m.pk)
        .then(() => removed.push(m.name))
        .catch(() => {})
    }
  }
  return removed
}

/** Forget a computer, and remove its agents from the channels this app owns. */
export async function removeComputer(machinePk: string): Promise<string[]> {
  // Forgotten first: from then on its agents' requests aren't yours, so auto-approval stops for it.
  await saveComputers(secrets().computers.filter((c) => c.machinePk !== machinePk))
  return removeAgentsOf(machinePk)
}

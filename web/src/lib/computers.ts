// Your computers: the ones paired with this app (kiwi pair), kept in the bridge's secrets store.
// Pairing runs in the main process over the relay's pairing mailbox (window.kiwi.pairBegin/Poll/
// Answer): the app shows a kp1- code, the computer runs `kiwi pair <code>`, and the person confirms
// what asked. Removing one takes its agents out of every channel this app owns, then forgets it.

import { allMembers } from "./channel"
import { linkOf, type ChannelLink } from "./channel-ops"
import { installLine } from "./join-line"
import { relayUrl } from "./relay"
import { takeAgents } from "./remove-agents"
import { bridge, saveComputers, secrets, type ComputerView, type PairAskView } from "./secrets"

export type { ComputerView, PairAskView }

/** What to paste on the computer to pair it: install-and-pair, or pair with kiwi already there. */
export function pairCommands(code: string): { install: string; pair: string } {
  return { install: installLine(relayUrl(), `pair ${code}`), pair: `kiwi pair ${code}` }
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
class PairingNeedsApp extends Error {
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
function owned(): ChannelLink[] {
  return allMembers()
    .filter((m) => m.identity.pk === m.access.ownerPk)
    .map(linkOf)
}

/** Take every agent that computer let in out of the channels this app owns; returns their names. */
async function removeAgentsOf(machinePk: string): Promise<string[]> {
  const { removed, leftover } = await takeAgents(machinePk, owned())
  if (leftover.length) {
    throw new Error(`Couldn’t remove ${leftover.join(", ")} from your channels. The computer is still paired.`)
  }
  return removed
}

/** Remove that computer's agents, then forget it. Pairing stays if a remove failed. */
export async function removeComputer(machinePk: string): Promise<string[]> {
  const removed = await removeAgentsOf(machinePk)
  await saveComputers(secrets().computers.filter((c) => c.machinePk !== machinePk))
  return removed
}

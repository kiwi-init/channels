// Your computers: the ones this app certified (its own, and each one approved after `kiwi login`),
// kept in the bridge's secrets store. Removing one takes its agents out of every channel this app
// owns, then forgets it.

import { allMembers } from "@kiwi/channel/store.ts";
import { linkOf, type ChannelLink } from "@kiwi/channel/channel-ops.ts";
import { takeAgents } from "./remove-agents";
import { bridge, saveComputers, secrets, type ComputerView } from "@kiwi/secrets/secrets.ts";

export type { ComputerView };

/**
 * The app's own computer: the daemon it runs, certified by this person, so agents on this machine
 * come in as theirs (and are let in on their own) like any of their computers'. Nothing else adds it:
 * the app does this once a person exists, and again only while it's missing. Null outside the app.
 */
export async function adoptThisComputer(): Promise<ComputerView | null> {
  const b = bridge();
  if (!b || !secrets().person || secrets().computers.some((c) => c.own)) return null;
  return b.daemonAdopt();
}

/** The channels this app owns, opened as their owner. */
function owned(): ChannelLink[] {
  return allMembers()
    .filter((m) => m.identity.pk === m.access.ownerPk)
    .map(linkOf);
}

/** Take every agent that computer let in out of the channels this app owns; returns their names. */
async function removeAgentsOf(machinePk: string): Promise<string[]> {
  const channels = owned();
  const kept = (await Promise.allSettled(channels.map((ch) => ch.dropDelegates([machinePk])))).filter((r) => r.status === "rejected");
  if (kept.length) {
    throw new Error(`Couldn’t take that computer’s access back in ${kept.length === 1 ? "one of your channels" : `${kept.length} of your channels`}. The computer is still one of yours.`);
  }
  const { removed, leftover } = await takeAgents(machinePk, channels);
  if (leftover.length) {
    throw new Error(`Couldn’t remove ${leftover.join(", ")} from your channels. The computer is still one of yours.`);
  }
  return removed;
}

/** Remove that computer's agents, then forget it. It stays if a remove failed. */
export async function removeComputer(machinePk: string): Promise<string[]> {
  const removed = await removeAgentsOf(machinePk);
  await saveComputers(secrets().computers.filter((c) => c.machinePk !== machinePk));
  return removed;
}

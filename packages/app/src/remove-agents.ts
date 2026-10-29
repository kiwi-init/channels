/** Pull a computer's agents out of owned channels. */

export interface ChannelAgents {
  members: () => Promise<readonly { pk: string; name: string; from?: { pk: string } }[]>;
  remove: (pk: string) => Promise<void>;
}

export interface TakeResult {
  removed: string[];
  leftover: string[];
}

async function takeOnce(machinePk: string, channels: readonly ChannelAgents[]): Promise<TakeResult> {
  const removed: string[] = [];
  const leftover: string[] = [];
  for (const ch of channels) {
    const members = await ch.members();
    for (const m of members) {
      if (m.from?.pk !== machinePk) continue;
      try {
        await ch.remove(m.pk);
        removed.push(m.name);
      } catch {
        leftover.push(m.name);
      }
    }
  }
  return { removed, leftover };
}

/**
 * Remove every member whose `from.pk` is this computer. One failed remove is
 * retried; leftover names mean the computer must stay paired.
 */
export async function takeAgents(machinePk: string, channels: readonly ChannelAgents[]): Promise<TakeResult> {
  const first = await takeOnce(machinePk, channels);
  if (!first.leftover.length) return first;
  const again = await takeOnce(machinePk, channels);
  return { removed: [...first.removed, ...again.removed], leftover: again.leftover };
}

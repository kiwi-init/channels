// Background approval: every channel this app owns is watched for join requests. A request from
// one of the person's own computers (its computer claim names this person key) is let in on its
// own, as an agent sponsored by the person (Channel.autoApprove); anything else waits in the channel
// for the person to decide.

import { TEND_SAFETY_MS, tendOnPush, tendOwned } from "./approval-tend";
import { loadMember } from "@kiwi/channel/store.ts";
import { linkOf, watches } from "@kiwi/channel/channel-ops.ts";
import { ownComputers, tendDelegates } from "./delegations";
import { tendLists } from "./device-lists";
import { followedLaunches, sawMembers, sawRequests } from "./launch-follow";
import { bridge, secrets } from "@kiwi/secrets/secrets.ts";

async function ownLinks() {
  const b = bridge();
  if (!b?.deviceNews) return [];
  return (await b.deviceNews().catch(() => null))?.links ?? [];
}

/** One pass over one owned channel: cut forgotten devices and approve own computers' agents. */
async function tend(code: string, person: string | undefined): Promise<void> {
  const m = loadMember(code);
  if (!m || m.identity.pk !== m.access.ownerPk) return;
  const ch = linkOf(m);
  const { lists } = await tendLists(code, await ownLinks(), ch).catch(() => ({ lists: undefined }));
  if (!person) return;
  if (lists) await tendDelegates(code, person, ownComputers(person, secrets().computers, lists.get(person)), ch).catch(() => null);
  const [{ PRESETS }, { cleanPersonalities }] = await Promise.all([import("@kiwi/core/presets.ts"), import("@kiwi/core/personalities.ts")]);
  const personalities = [...PRESETS, ...cleanPersonalities(secrets().personalities)];
  if (followedLaunches(code).length) sawRequests(code, await ch.requests({ person, ...(lists ? { lists } : {}) }).catch(() => []));
  const api = {
    autoApprove: async (p: string) => {
      const members = await ch.autoApprove(p, personalities, null, lists);
      sawMembers(code, members);
      return members;
    },
    requests: (o: { person: string }) => ch.requests({ ...o, ...(lists ? { lists } : {}) }),
  };
  await tendOwned(person, api);
}

/** Watch every owned channel in `rows` while the app runs (the tray keeps it running when closed). */
export function startAutoApproval(codes: string[]): () => void {
  const tending = tendOnPush(codes, watches().watch, (code) => tend(code, secrets().person?.pk));
  const timer = window.setInterval(() => {
    for (const code of codes) tending.kick(code);
  }, TEND_SAFETY_MS);
  return () => {
    tending.stop();
    clearInterval(timer);
  };
}

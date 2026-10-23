import { RelayError } from "@kiwi/core/client/errors.ts";
import { decodeJoinCode, ownerFingerprint } from "@kiwi/core/crypto.ts";
import { ops } from "../channel-ops";
import { relayUrl } from "../relay";
import type { ChannelView } from "../secrets";
import { asMember, asPending, changed, type PendingJoin, type StoredMember } from "./store";

function memberOf(v: ChannelView): StoredMember {
  const m = asMember(v);
  if (!m) throw new Error("the channel came back without its access");
  return m;
}

export async function createChannel(name: string, token: string | null, me: { name: string } | null): Promise<StoredMember> {
  const m = memberOf(await ops().create(name, token, me));
  changed();
  return m;
}

export async function inviteInfo(code: string): Promise<{ ownerName: string | null } | null> {
  const { roomId, ownerFp } = decodeJoinCode(code);
  const res = await fetch(`${relayUrl()}/v1/rooms/${roomId}/info?fp=${encodeURIComponent(ownerFp)}`);
  const body = (await res.json().catch(() => ({}))) as { ownerPk: string; ownerName?: string | null; error?: string; tag?: string };
  if (!res.ok) {
    const err = new RelayError(res.status, body.error ?? `the relay returned ${res.status}`, body.tag);
    if (err.tag === "ChannelGone") return null;
    throw err;
  }
  const info = body;
  if ((await ownerFingerprint(info.ownerPk)) !== ownerFp) throw new Error("The relay is serving a different owner than this code names.");
  return { ownerName: info.ownerName ?? null };
}

export async function askToJoin(code: string, name: string): Promise<PendingJoin> {
  const p = asPending(await ops().requestJoin(code, name));
  if (!p) throw new Error("the join request came back without its id");
  changed();
  return p;
}

export async function checkJoin(p: PendingJoin): Promise<{ code: string | null } | "denied" | StoredMember> {
  const r = await ops().joinStatus(p.code);
  if (r.status === "denied") return "denied";
  if (r.status === "pending") return { code: r.code };
  changed();
  return memberOf(r.channel);
}

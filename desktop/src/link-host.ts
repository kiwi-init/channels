import {
  dropLink,
  linkCode,
  linkDigits,
  newLinkKeys,
  newLinkSecret,
  personFingerprint,
  sealLink,
  waitForLinkAsk,
  writeLinkChunks,
  type LinkAsk,
  type LinkChannel,
  type LinkKeys,
  type LinkPayload,
} from "@kiwi/core/link.ts";
import type { ChannelIdentityView, LinkAskView, PersonView, PhoneView } from "./bridge.ts";

export interface LinkHostDeps {
  relayUrl: () => string;
  person: () => PersonView;
  channels: () => ChannelIdentityView[];
  linked: (phone: PhoneView) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface LinkHost {
  begin(): Promise<{ code: string }>;
  poll(): Promise<LinkAskView | null>;
  answer(accept: boolean): Promise<PhoneView | null>;
  cancel(): Promise<void>;
}

interface Linking {
  secret: string;
  keys: LinkKeys;
  relay: string;
  ask: LinkAsk | null;
  stop: AbortController;
}

const POLL_MS = 20_000;

export function createLinkHost(deps: LinkHostDeps): LinkHost {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  let linking: Linking | null = null;

  const drop = async (l: Linking) => {
    l.stop.abort();
    await dropLink(l.relay, l.secret, 1, fetchImpl).catch(() => {});
  };

  return {
    async begin() {
      const person = deps.person();
      if (linking) await drop(linking);
      const secret = newLinkSecret();
      const keys = await newLinkKeys();
      const relay = deps.relayUrl();
      linking = { secret, keys, relay, ask: null, stop: new AbortController() };
      return { code: linkCode({ secret, dxpk: keys.xpk, personFp: await personFingerprint(person.pk), relay }) };
    },

    async poll() {
      const l = linking;
      if (!l) throw new Error("linking hasn't started");
      const found = await waitForLinkAsk(l.relay, l.secret, { timeoutMs: POLL_MS, everyMs: 1_500, signal: l.stop.signal }, fetchImpl).catch((err: unknown) => {
        if (linking === l) throw err;
        return null;
      });
      if (!found || linking !== l) return null;
      l.ask = found.ask;
      return { label: found.ask.label, digits: await linkDigits(l.secret, l.keys.xpk, found.ask.pxpk), at: found.ask.at };
    },

    async answer(accept) {
      const l = linking;
      if (!l) throw new Error("linking hasn't started");
      linking = null;
      l.stop.abort();
      if (!accept || !l.ask) {
        await dropLink(l.relay, l.secret, 1, fetchImpl).catch(() => {});
        return null;
      }
      const person = deps.person();
      const payload: LinkPayload = {
        kind: "kiwi-link-payload",
        v: 1,
        person: { name: person.name, pk: person.pk, sk: person.sk, xpk: person.xpk, xsk: person.xsk },
        channels: deps.channels().map((c): LinkChannel => ({ ...c })),
        relayUrl: l.relay,
        at: now(),
      };
      const chunks = await sealLink(l.secret, l.keys.xsk, l.keys.xpk, l.ask.pxpk, payload);
      await writeLinkChunks(l.relay, l.secret, chunks, fetchImpl);
      const phone: PhoneView = { label: l.ask.label, at: now(), channels: payload.channels.map((c) => c.label) };
      deps.linked(phone);
      return phone;
    },

    async cancel() {
      const l = linking;
      linking = null;
      if (l) await drop(l);
    },
  };
}

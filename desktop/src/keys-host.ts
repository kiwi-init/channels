import { claimDevice } from "@kiwi/core/devices.ts";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import type { JoinClaims } from "@kiwi/core/membership.ts";
import { tokenForRelay } from "./github-flow.ts";
import { acceptSeat, withAccess } from "./guard.ts";
import type { KeysToHost } from "./keys-server.ts";
import { mutate, store } from "./store.ts";

export type KeysAsk = Exclude<KeysToHost, { type: "flushed" }>;

export interface KeysAnswer {
  error?: string;
  claim?: JoinClaims | null;
  token?: string | null;
}

export function answerKeys(m: KeysAsk, done: (extra?: KeysAnswer) => void): void {
  const fail = (e: unknown) => done({ error: e instanceof Error ? e.message : String(e) });
  try {
    switch (m.type) {
      case "save":
        mutate((s) => (s.channels = acceptSeat(s.channels, m.entry)));
        return done();
      case "access":
        mutate((s) => (s.channels = withAccess(s.channels, m.code, m.pk, m.access)));
        return done();
      case "forget":
        mutate((s) => (s.channels = s.channels.filter((c) => c.code !== m.code)));
        return done();
      case "githubToken":
        return void tokenForRelay(store.relayUrl, store.github).then((token) => done({ token }), fail);
      case "prove":
        if (store.device && store.deviceLinks?.length)
          return void claimDevice(store.device, store.deviceLinks, decodeJoinCode(m.code).roomId, m.memberPk).then((device) => done({ claim: { device } }), fail);
        return done({ claim: null });
    }
  } catch (e) {
    fail(e);
  }
}

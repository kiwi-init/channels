import type { PersonClaim } from "@kiwi/core/person.ts";
import { tokenForRelay } from "./github-flow.ts";
import { acceptSeat, claimFor, withAccess } from "./guard.ts";
import type { KeysToHost } from "./keys-server.ts";
import { mutate, requirePerson, store } from "./store.ts";

export type KeysAsk = Exclude<KeysToHost, { type: "flushed" }>;

export interface KeysAnswer {
  error?: string;
  claim?: PersonClaim | null;
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
        if (!store.person) return done({ claim: null });
        void claimFor(requirePerson(), m.code, m.memberPk).then((claim) => done({ claim }), fail);
        return;
    }
  } catch (e) {
    fail(e);
  }
}

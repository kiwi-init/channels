import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { useHost, type Host } from "../desktop/src/host.ts";
import { linkRecord } from "../desktop/src/ipc/github.ts";
import { signInCalls } from "../desktop/src/ipc/signin.ts";
import { createToken, freshToken } from "../desktop/src/signin.ts";
import { openStore, store, type StoreFile } from "../desktop/src/store.ts";

const CLIENT = "Iv23liClient";
const serve = (config: object) => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json(config) });
const github = serve({ workosClientId: "client_old", githubClientId: CLIENT, githubSignIn: true });
const older = serve({ workosClientId: "client_old", githubClientId: CLIENT });
afterAll(() => {
  github.stop(true);
  older.stop(true);
});

const LINK_TOKEN = `ghu_${"a".repeat(36)}`;
const link = (relay: string, first = true) => ({ login: "octocat", id: 583231, token: LINK_TOKEN, at: 1, relay, clientId: CLIENT, ...(first ? { first } : {}) });
const person = { name: "octocat", pk: "pk", xpk: "xpk", secret: "s" } as unknown as StoreFile["person"];
const session = { access: "workos-access", refresh: "r", exp: Number.MAX_SAFE_INTEGER };

function open(file: Partial<StoreFile>): void {
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file, resave: false }), save: () => {} });
}

const pushed: string[] = [];
const host = { push: (event: string) => void pushed.push(event), openExternal: async () => {}, tellKeys: () => {} } as unknown as Host;
useHost(host);

beforeEach(() => void (pushed.length = 0));

describe("on a relay that takes GitHub sign-in", () => {
  test("the GitHub link is the token for creating a channel, and for the account when there is no WorkOS session", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, github: link(relay) });
    expect(await createToken()).toBe(LINK_TOKEN);
    expect(await freshToken()).toBe(LINK_TOKEN);
  });

  test("someone who already has a WorkOS session creates with GitHub, and keeps their account under WorkOS until it moves", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, github: link(relay), signin: session });
    expect(await createToken()).toBe(LINK_TOKEN);
    expect(await freshToken()).toBe("workos-access");
  });

  test("signing in when already signed in hands back the token and starts no new GitHub flow", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, github: link(relay) });
    expect(await signInCalls(host).signIn()).toEqual({ token: LINK_TOKEN });
    expect(pushed).toEqual([]);
  });

  test("signing out drops the GitHub token, so the next sign-in asks GitHub again, and keeps the WorkOS session the account is under", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, github: link(relay), signin: session });
    await signInCalls(host).signOut();
    expect(store.github?.token).toBe("");
    expect(store.github?.first).toBe(true);
    expect(await createToken()).toBe("workos-access");
    expect(store.signin).toEqual(session);
    expect(await freshToken()).toBe("workos-access");
  });

  test("someone whose key came before GitHub, with no WorkOS session left, gets no account token instead of an empty github_<id> account", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, person, github: link(relay, false) });
    expect(await createToken()).toBe(LINK_TOKEN);
    expect(await freshToken()).toBeNull();
  });

  test("a link remembers whether GitHub came before the key, and signing in again as the same account keeps it", () => {
    const found = { login: "octocat", id: 583231, token: LINK_TOKEN };
    expect(linkRecord({ person: null }, found, "r", CLIENT, 5).first).toBe(true);
    expect(linkRecord({ person }, found, "r", CLIENT, 5).first).toBeUndefined();
    expect(linkRecord({ person, github: { ...link("r"), token: "" } }, found, "r", CLIENT, 5).first).toBe(true);
    expect(linkRecord({ person, github: { ...link("r"), id: 1 } }, found, "r", CLIENT, 5).first).toBeUndefined();
  });

  test("a link made on another relay signs nobody in here", async () => {
    open({ relayUrl: github.url.origin, github: link(older.url.origin) });
    expect(await createToken()).toBeNull();
    expect(await freshToken()).toBeNull();
  });
});

describe("on a relay that doesn't take GitHub sign-in yet", () => {
  test("the WorkOS session stays the token, and signing out keeps the GitHub link", async () => {
    const relay = older.url.origin;
    open({ relayUrl: relay, github: link(relay), signin: session });
    expect(await createToken()).toBe("workos-access");
    expect(await freshToken()).toBe("workos-access");
    await signInCalls(host).signOut();
    expect(store.github?.token).toBe(LINK_TOKEN);
    expect(store.signin).toBeUndefined();
  });
});

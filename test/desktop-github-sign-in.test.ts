import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { useHost, type Host } from "../desktop/src/host.ts";
import { signInCalls } from "../desktop/src/ipc/signin.ts";
import { signInToken } from "../desktop/src/signin.ts";
import { openStore, store, type StoreFile } from "../desktop/src/store.ts";

const CLIENT = "Iv23liClient";
const serve = (config: object) => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json(config) });
const github = serve({ githubClientId: CLIENT, githubSignIn: true });
const other = serve({ githubClientId: CLIENT, githubSignIn: true });
const none = serve({ githubSignIn: false });
const dev = serve({ githubSignIn: false, dev: true });
afterAll(() => {
  for (const s of [github, other, none, dev]) s.stop(true);
});

const LINK_TOKEN = `ghu_${"a".repeat(36)}`;
const link = (relay: string) => ({ login: "octocat", id: 583231, token: LINK_TOKEN, at: 1, relay, clientId: CLIENT });
const person = { name: "octocat", pk: "pk", xpk: "xpk", secret: "s" } as unknown as StoreFile["person"];

function open(file: Partial<StoreFile>): void {
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file, resave: false }), save: () => {} });
}

const pushed: string[] = [];
const host = { push: (event: string) => void pushed.push(event), openExternal: async () => {}, tellKeys: () => {} } as unknown as Host;
useHost(host);

beforeEach(() => void (pushed.length = 0));

describe("on a relay that takes GitHub sign-in", () => {
  test("the GitHub link is the token for creating a channel and for the account", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, github: link(relay) });
    expect(await signInToken()).toBe(LINK_TOKEN);
    expect(await signInCalls(host).getToken()).toBe(LINK_TOKEN);
  });

  test("a person key made before the link changes nothing: the GitHub sign-in is still the account's", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, person, github: link(relay) });
    expect(await signInToken()).toBe(LINK_TOKEN);
  });

  test("signing in when already signed in hands back the token and starts no new GitHub flow", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, github: link(relay) });
    expect(await signInCalls(host).signIn()).toEqual({ token: LINK_TOKEN });
    expect(pushed).toEqual([]);
  });

  test("signing out drops the GitHub token, so there is no token until the next sign-in asks GitHub again", async () => {
    const relay = github.url.origin;
    open({ relayUrl: relay, github: link(relay) });
    await signInCalls(host).signOut();
    expect(store.github?.token).toBe("");
    expect(await signInToken()).toBeNull();
  });

  test("a link made on another relay signs nobody in here", async () => {
    open({ relayUrl: github.url.origin, github: link(other.url.origin) });
    expect(await signInToken()).toBeNull();
  });

  test("a dev sign-in kept from a dev relay is no token here", async () => {
    open({ relayUrl: github.url.origin, signin: { access: "dev:octo" } });
    expect(await signInToken()).toBeNull();
  });
});

describe("on a relay without sign-in", () => {
  test("there is no token, and signing in says so", async () => {
    const relay = none.url.origin;
    open({ relayUrl: relay, github: link(relay) });
    expect(await signInToken()).toBeNull();
    await expect(signInCalls(host).signIn()).rejects.toThrow("this relay has no sign-in");
  });
});

describe("on a dev relay", () => {
  test("signing in asks for a name, the name is the token, and signing out forgets it", async () => {
    const relay = dev.url.origin;
    open({ relayUrl: relay });
    expect(await signInCalls(host).signIn()).toEqual({ dev: true });
    expect(await signInCalls(host).devSignIn("octo cat")).toEqual({ token: "dev:octocat" });
    expect(await signInToken()).toBe("dev:octocat");
    await signInCalls(host).signOut();
    expect(store.signin).toBeUndefined();
    expect(await signInToken()).toBeNull();
  });
});

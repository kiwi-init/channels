import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, relayConfig } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubHumanAuth, withGithub, type HumanAuth } from "../src/relay/human.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";
import { createEnrollee } from "../desktop/src/devices.ts";

const CLIENT = "Iv23liTestClient";
const SECRET = "test-secret";
const OCTO = `ghu_${"o".repeat(36)}`;
const MONA = `ghu_${"m".repeat(36)}`;
const OTHER_APP = `ghu_${"x".repeat(36)}`;
const USERS: Record<string, { id: number; login: string; name: string | null; email: string | null }> = {
  [OCTO]: { id: 583231, login: "octocat", name: "The Octocat", email: null },
  [MONA]: { id: 7, login: "mona", name: null, email: "mona@example.com" },
};

const asked: string[] = [];
const github = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const token = (JSON.parse(String(init?.body ?? "{}")) as { access_token?: string }).access_token ?? "";
  asked.push(token);
  if (url !== `https://api.github.com/applications/${CLIENT}/token` || init?.method !== "POST") return new Response("not found", { status: 404 });
  if (new Headers(init.headers).get("authorization") !== `Basic ${btoa(`${CLIENT}:${SECRET}`)}`) return new Response("bad credentials", { status: 401 });
  const user = USERS[token];
  return user ? Response.json({ token, app: { client_id: CLIENT }, user }) : new Response("not found", { status: 404 });
}) as typeof fetch;

const workos: HumanAuth = { clientId: "client_old", verify: async (t) => (t === "old.workos.jwt" ? "user_old" : null) };

describe("GitHub sign-in at the relay", () => {
  test("takes a token GitHub says this relay's app issued, as github_<id>, and asks GitHub once per token", async () => {
    const auth = githubHumanAuth({ clientId: CLIENT, clientSecret: SECRET }, github)!;
    asked.length = 0;
    expect(await auth.verify(OCTO)).toBe("github_583231");
    expect(await auth.verify(OCTO)).toBe("github_583231");
    expect(asked).toEqual([OCTO]);
    expect(await auth.profile!("github_583231")).toEqual({ name: "The Octocat", login: "octocat" });
    expect(await auth.verify(MONA)).toBe("github_7");
    expect(await auth.profile!("github_7")).toEqual({ name: "mona", login: "mona", email: "mona@example.com" });
  });

  test("refuses another app's token, anything not shaped like a GitHub token, and an unreachable GitHub", async () => {
    const auth = githubHumanAuth({ clientId: CLIENT, clientSecret: SECRET }, github)!;
    asked.length = 0;
    expect(await auth.verify(OTHER_APP)).toBeNull();
    expect(await auth.verify("ghp_personalAccessTokenxxxxxxxxxxxxxxxx")).toBeNull();
    expect(await auth.verify("old.workos.jwt")).toBeNull();
    expect(asked).toEqual([OTHER_APP]);
    const down = githubHumanAuth({ clientId: CLIENT, clientSecret: SECRET }, (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch)!;
    expect(await down.verify(OCTO)).toBeNull();
  });

  test("without the app's client secret the relay takes no GitHub sign-in and keeps WorkOS as it was", () => {
    expect(githubHumanAuth({ clientId: CLIENT }, github)).toBeNull();
    expect(withGithub(workos, { clientId: CLIENT }, github)).toBe(workos);
    expect(withGithub(null, {}, github)).toBeNull();
  });

  test("each token goes to the sign-in that issued its kind: GitHub's to GitHub, older apps' WorkOS JWTs to WorkOS", async () => {
    const both = withGithub(workos, { clientId: CLIENT, clientSecret: SECRET }, github)!;
    expect(both).toMatchObject({ clientId: "client_old", github: true });
    expect(await both.verify(OCTO)).toBe("github_583231");
    expect(await both.verify("old.workos.jwt")).toBe("user_old");
    expect(await both.verify("")).toBeNull();
    expect(withGithub(null, { clientId: CLIENT, clientSecret: SECRET }, github)).toMatchObject({ clientId: null, github: true });
  });
});

describe("creating a channel with a GitHub sign-in", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-gh-signin-"));
  let server: ReturnType<typeof startRelay>;
  let relay: string;

  beforeAll(() => {
    server = startRelay({
      port: 0,
      hostname: "127.0.0.1",
      dataDir,
      human: withGithub(workos, { clientId: CLIENT, clientSecret: SECRET }, github),
      policy: { ...OPEN_POLICY, betaUsers: ["github:octocat", "user_old"] },
    });
    relay = server.url.origin;
  });
  afterAll(() => {
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("/v1/config says GitHub sign-in is taken, and still names WorkOS for older apps", async () => {
    expect(await relayConfig(relay)).toMatchObject({ workosClientId: "client_old", githubSignIn: true });
  });

  test("a phone asking to join a GitHub sign-in that has no devices yet hears to open Channels on its computer; an older account keeps its words", async () => {
    const ask = (token: string) =>
      createEnrollee({ relayUrl: () => relay, token: async () => token, who: () => null, enrolled: () => {}, label: () => "iPhone", os: () => "iOS 27", as: "phone" }).begin();
    await expect(ask(MONA)).rejects.toThrow("open Channels on your computer once to move your devices to your GitHub sign-in, then try again");
    await expect(ask("old.workos.jwt")).rejects.toThrow("no app of this account can approve a device yet: sign in on your first app");
  });

  test("a GitHub sign-in creates a channel, an older app's WorkOS one still does, and the beta list names GitHub logins", async () => {
    const [a, b, c, d] = await Promise.all([generateIdentity("a"), generateIdentity("b"), generateIdentity("c"), generateIdentity("d")]);
    expect((await Channel.create(relay, a, { name: "octocat", kind: "human" }, [], undefined, OCTO)).code).toBeTruthy();
    expect((await Channel.create(relay, b, { name: "old", kind: "human" }, [], undefined, "old.workos.jwt")).code).toBeTruthy();
    await expect(Channel.create(relay, c, { name: "mona", kind: "human" }, [], undefined, MONA)).rejects.toMatchObject({ status: 403 });
    await expect(Channel.create(relay, d, { name: "nobody", kind: "human" }, [], undefined, OTHER_APP)).rejects.toMatchObject({ status: 401 });
  });
});

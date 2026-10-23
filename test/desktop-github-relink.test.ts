import { afterAll, expect, mock, test } from "bun:test";
import { join } from "node:path";
import type { Push, Pushes } from "../desktop/src/calls.ts";
import { useHost, type Host } from "../desktop/src/host.ts";
import { openStore } from "../desktop/src/store.ts";
import { fakeHost } from "./fake-host.ts";

mock.module(join(import.meta.dir, "../desktop/src/open.ts"), () => ({
  browserEnv: () => ({}),
  openInBrowser: (url: string, fallback: (u: string) => Promise<void>) => fallback(url),
}));

const RELAY = "https://relay.example";
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
globalThis.fetch = Object.assign(
  async (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${RELAY}/v1/config`) return Response.json({ githubClientId: "Iv1.test" });
    if (url === "https://github.com/login/device/code")
      return Response.json({ device_code: "device", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    if (url === "https://github.com/login/oauth/access_token") return new Promise<Response>(() => {});
    return new Response("not faked", { status: 404 });
  },
  { preconnect: realFetch.preconnect },
);

const pushed: [Push, Pushes[Push]][] = [];
const host: Host = { ...fakeHost().host, push: (name, value) => void pushed.push([name, value]) };
useHost(host);
openStore({ where: () => "memory", load: () => ({ ok: true, file: { relayUrl: RELAY }, resave: false }), save: () => {} });
const handlersPath = "../desktop/src/ipc/handlers.ts";
const { handlers } = (await import(handlersPath)) as typeof import("../desktop/src/ipc/handlers.ts");

test("a page that presses Link while a link runs joins the same flow and gets that flow's code again, as after a reload (T1741)", async () => {
  const table = handlers(host);
  const code = { code: "ABCD-1234", url: "https://github.com/login/device" };
  const first = table.githubLink();
  for (let i = 0; i < 50 && pushed.length === 0; i++) await Bun.sleep(10);
  expect(pushed).toEqual([["githubCode", code]]);
  const again = table.githubLink();
  expect(again).toBe(first);
  expect(pushed).toEqual([
    ["githubCode", code],
    ["githubCode", code],
  ]);
});

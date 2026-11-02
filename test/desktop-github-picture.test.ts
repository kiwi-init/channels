import { afterAll, expect, test } from "bun:test";
import type { Host } from "../desktop/src/host.ts";
import { githubCalls } from "../desktop/src/ipc/github.ts";
import { openStore, type StoreFile } from "../desktop/src/store.ts";

const realFetch = globalThis.fetch;
afterAll(() => void (globalThis.fetch = realFetch));

const host = { push: () => {}, openExternal: async () => {}, tellKeys: () => {} } as unknown as Host;

function linked(id: number): void {
  const github = { login: "octocat", id, token: "ghu_x", at: 1, relay: "https://relay.example", clientId: "Iv1.abc" };
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file: { github } as Partial<StoreFile>, resave: false }), save: () => {} });
}

function avatars(replies: (() => Response)[]): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    asked.push(String(url));
    return (replies.shift() ?? (() => new Response(null, { status: 404 })))();
  }) as typeof fetch;
  return asked;
}

const jpeg = (): Response => new Response(new Uint8Array(3000).fill(7), { headers: { "content-type": "image/jpeg" } });

test("a picture that didn't come is asked for again, and one that came is kept", async () => {
  linked(901);
  const asked = avatars([() => new Response(null, { status: 503 }), jpeg]);
  const calls = githubCalls(host);
  expect(await calls.githubPicture()).toBeNull();
  await Promise.resolve();
  const p = await calls.githubPicture();
  expect(p?.mime).toBe("image/jpeg");
  expect(await calls.githubPicture()).toBe(p);
  expect(asked).toHaveLength(2);
});

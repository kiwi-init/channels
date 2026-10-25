import { afterEach, expect, test } from "bun:test";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost } from "./fake-host.ts";
import { FEED, releasePage, releasesFeed } from "./livewire-feed.ts";

useHost(fakeHost({ packaged: false, version: "0.19.0" }).host);

type Checked = { state: "current"; version: string } | { state: "failed" } | { state: "downloading" | "ready" | "available"; version: string; url: string };
const updater = "../desktop/src/updater.ts";
const { checkForUpdate } = (await import(updater)) as { checkForUpdate: () => Promise<Checked> };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: string | null, seen: string[] = []): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(`${String(input)}${init?.redirect === "error" ? " (redirect: error)" : ""}`);
      return new Response(body, { status });
    },
    { preconnect: realFetch.preconnect },
  );
}

const asked = `${FEED} (redirect: error)`;

test("RCs are read off github.com's releases feed, never api.github.com and its 60 calls an hour per IP (T985), and only vYYYY.M.PATCH-livewire.N tags count, so a stable release or RC is never offered (T839)", async () => {
  const seen: string[] = [];
  answer(200, releasesFeed("v0.30.0", "v0.31.0-rc.1", "v0.19.0-livewire.1"), seen);
  expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
  expect(seen).toEqual([asked]);
});

test("the newest -livewire.N tag in the feed wins, whatever its place, and is only offered with its link when the app isn't packaged: nothing is downloaded", async () => {
  const seen: string[] = [];
  answer(200, releasesFeed("v0.20.0-livewire.2", "v0.40.0", "v0.20.0-livewire.10", "v0.20.0-livewire.9"), seen);
  expect(await checkForUpdate()).toEqual({ version: "0.20.0-livewire.10", state: "available", url: releasePage("v0.20.0-livewire.10") });
  expect(seen).toEqual([asked]);
});

test("a feed with no Livewire release yet is current, not a failure", async () => {
  answer(200, releasesFeed("v0.30.0"));
  expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
});

test("a tag that isn't vYYYY.M.PATCH-livewire.N, or a link anywhere but this repo's release tag, is never picked: it never reaches a file name or the swap script (T1554)", async () => {
  for (const tag of [
    "v9.9.9-livewire.1/../../x",
    "v99.0.0-livewire.1'; rm -rf ~; '",
    "v1.0.0",
    "v1.0.0-rc.1",
    "v0.27-livewire.1",
    "V99.0.0-livewire.1",
    "v99.0.0-LIVEWIRE.1",
    "LIVEWIRE-v99.0.0-livewire.1",
    "livewire-v99.0.0-livewire.1",
  ]) {
    const seen: string[] = [];
    answer(200, releasesFeed(tag), seen);
    expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
    expect(seen).toEqual([asked]);
  }
  for (const href of [
    "https://evil.example/kiwi-init/channels/releases/tag/v99.0.0-livewire.1",
    "https://github.com/someone/else/releases/tag/v99.0.0-livewire.1",
    "http://github.com/kiwi-init/channels/releases/tag/v99.0.0-livewire.1",
  ]) {
    answer(200, `<feed><entry><link rel="alternate" href="${href}"/></entry></feed>`);
    expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
  }
});

test("GitHub not answering, answering with something that isn't a feed, or rate-limiting is a failed check", async () => {
  answer(503, null);
  expect(await checkForUpdate()).toEqual({ state: "failed" });
  answer(200, "<html>sign in</html>");
  expect(await checkForUpdate()).toEqual({ state: "failed" });
  answer(429, releasesFeed("v0.20.0-livewire.1"));
  expect(await checkForUpdate()).toEqual({ state: "failed" });
  answer(302, null);
  expect(await checkForUpdate()).toEqual({ state: "failed" });
  globalThis.fetch = Object.assign(
    async () => {
      throw new Error("offline");
    },
    { preconnect: realFetch.preconnect },
  );
  expect(await checkForUpdate()).toEqual({ state: "failed" });
});

test("a check already under way is shared, not started twice", async () => {
  const seen: string[] = [];
  answer(200, releasesFeed("v0.19.0-livewire.1"), seen);
  const [a, b] = await Promise.all([checkForUpdate(), checkForUpdate()]);
  expect(a).toEqual(b);
  expect(seen).toHaveLength(1);
});

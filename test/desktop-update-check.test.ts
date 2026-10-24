import { afterEach, expect, test } from "bun:test";
import { useHost } from "../desktop/src/host.ts";
import { fakeHost } from "./fake-host.ts";

useHost(fakeHost({ packaged: false, version: "0.19.0" }).host);

type Checked = { state: "current"; version: string } | { state: "failed" } | { state: "downloading" | "ready" | "available"; version: string; url: string };
const updater = "../desktop/src/updater.ts";
const { checkForUpdate } = (await import(updater)) as { checkForUpdate: () => Promise<Checked> };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const LATEST = "https://github.com/kiwi-init/channels/releases/latest";
const page = (tag: string) => `https://github.com/kiwi-init/channels/releases/tag/${tag}`;

function answer(status: number, location: string | null, seen: string[] = []): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(`${String(input)}${init?.redirect === "manual" ? " (redirect: manual)" : ""}`);
      return new Response(null, { status, headers: location ? { location } : {} });
    },
    { preconnect: realFetch.preconnect },
  );
}

test("the latest release is read off github.com's releases/latest redirect, never api.github.com and its 60 calls an hour per IP (T985)", async () => {
  const seen: string[] = [];
  answer(302, page("v0.19.0"), seen);
  expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
  expect(seen).toEqual([`${LATEST} (redirect: manual)`]);
});

test("a newer release is only offered with its link when the app isn't packaged: nothing is downloaded", async () => {
  const seen: string[] = [];
  answer(302, page("v0.20.0"), seen);
  expect(await checkForUpdate()).toEqual({ version: "0.20.0", state: "available", url: page("v0.20.0") });
  expect(seen).toEqual([`${LATEST} (redirect: manual)`]);
});

test("a tag that isn't v and a plain version, or a redirect anywhere but this repo's release tag, is a failed check: it never reaches a file name or the swap script (T1554)", async () => {
  for (const tag of ["v9.9.9/../../x", "v99.0.0'; rm -rf ~; '", "v1.0.0-rc.1", "v0.27", "latest", "0.27.0", "V0.27.0"]) {
    const seen: string[] = [];
    answer(302, page(tag), seen);
    expect(await checkForUpdate()).toEqual({ state: "failed" });
    expect(seen).toEqual([`${LATEST} (redirect: manual)`]);
  }
  for (const to of ["https://github.com/kiwi-init/channels/releases", "https://evil.example/kiwi-init/channels/releases/tag/v0.20.0", "https://github.com/someone/else/releases/tag/v0.20.0"]) {
    answer(302, to);
    expect(await checkForUpdate()).toEqual({ state: "failed" });
  }
});

test("GitHub not answering, answering without a redirect, or rate-limiting is a failed check", async () => {
  answer(503, null);
  expect(await checkForUpdate()).toEqual({ state: "failed" });
  answer(200, null);
  expect(await checkForUpdate()).toEqual({ state: "failed" });
  answer(429, null);
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
  answer(302, page("v0.19.0"), seen);
  const [a, b] = await Promise.all([checkForUpdate(), checkForUpdate()]);
  expect(a).toEqual(b);
  expect(seen).toHaveLength(1);
});

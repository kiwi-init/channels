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

function answer(status: number, body: object, seen: string[] = []): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response(JSON.stringify(body), { status });
    },
    { preconnect: realFetch.preconnect },
  );
}

test("this version being the latest release says so, with the version", async () => {
  answer(200, { tag_name: "v0.19.0", html_url: "https://github.com/ojowwalker77/channels/releases/tag/v0.19.0" });
  expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
});

test("a pre-release or a draft never counts as newer", async () => {
  answer(200, { tag_name: "v0.20.0", prerelease: true });
  expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
  answer(200, { tag_name: "v0.20.0", draft: true });
  expect(await checkForUpdate()).toEqual({ state: "current", version: "0.19.0" });
});

test("a newer release is only offered with its link when the app isn't packaged: nothing is downloaded", async () => {
  const seen: string[] = [];
  answer(
    200,
    { tag_name: "v0.20.0", html_url: "https://github.com/ojowwalker77/channels/releases/tag/v0.20.0", assets: [{ name: "SHA256SUMS", browser_download_url: "https://example.com/SHA256SUMS" }] },
    seen,
  );
  expect(await checkForUpdate()).toEqual({ version: "0.20.0", state: "available", url: "https://github.com/ojowwalker77/channels/releases/tag/v0.20.0" });
  expect(seen).toEqual(["https://api.github.com/repos/ojowwalker77/channels/releases/latest"]);
});

test("a tag that isn't v and a plain version is a failed check: it never reaches a file name or the swap script (T1554)", async () => {
  for (const tag of ["v9.9.9/../../x", "v99.0.0'; rm -rf ~; '", "v1.0.0-rc.1", "v0.27.0\n", "v0.27", "latest", "0.27.0", "V0.27.0"]) {
    const seen: string[] = [];
    answer(
      200,
      { tag_name: tag, html_url: "https://github.com/ojowwalker77/channels/releases/latest", assets: [{ name: "SHA256SUMS", browser_download_url: "https://example.com/SHA256SUMS" }] },
      seen,
    );
    expect(await checkForUpdate()).toEqual({ state: "failed" });
    expect(seen).toEqual(["https://api.github.com/repos/ojowwalker77/channels/releases/latest"]);
  }
});

test("GitHub not answering, or answering without a version, is a failed check", async () => {
  answer(503, {});
  expect(await checkForUpdate()).toEqual({ state: "failed" });
  answer(200, {});
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
  answer(200, { tag_name: "v0.19.0" }, seen);
  const [a, b] = await Promise.all([checkForUpdate(), checkForUpdate()]);
  expect(a).toEqual(b);
  expect(seen).toHaveLength(1);
});

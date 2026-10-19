import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function failWith(make: string): string {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-cli-failures-"));
  try {
    const script = join(dir, "fail.ts");
    writeFileSync(
      script,
      `import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { RelayError, Unreachable } from "${ROOT}/packages/core/src/client.ts";
import { LocalFiles } from "${ROOT}/src/config.ts";
import { fail } from "${ROOT}/src/cli/fail.ts";
const err = ${make};
await Effect.runPromise(Effect.provide(fail(Cause.fail(err)), LocalFiles));
`,
    );
    const r = Bun.spawnSync([process.execPath, script], { cwd: ROOT, env: { ...process.env, KIWI_HOME: dir }, stdout: "pipe", stderr: "pipe" });
    return r.stderr.toString().trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a relay that can't be reached is named, said in plain words, with what to do", () => {
  expect(failWith(`new Unreachable({ cause: new Error("Unable to connect. Is the computer able to access the url?"), url: "https://relay.example" })`)).toBe(
    "kiwi: can't reach the relay at https://relay.example (connection refused): check your network and whether the relay is up, then try again",
  );
  expect(
    failWith(
      `new Unreachable({ cause: new Error("The socket connection was closed unexpectedly. For more information, pass \`verbose: true\` in the second argument to fetch()"), url: "https://relay.example" })`,
    ),
  ).toBe("kiwi: can't reach the relay at https://relay.example (the connection dropped): check your network and whether the relay is up, then try again");
});

test("a relay that fails or limits says so once, with when to try again", () => {
  expect(failWith(`new RelayError(503, "the relay returned 503")`)).toBe("kiwi: the relay failed (503: the relay returned 503): it's having trouble, try again in a minute");
  expect(failWith(`new RelayError(429, "too many messages; wait a minute", "TooMany", "30")`)).toBe("kiwi: the relay is limiting this computer (too many messages; wait a minute): try again in 30s");
  expect(failWith(`new RelayError(403, "only the owner can do that")`)).toBe("kiwi: relay: only the owner can do that");
});

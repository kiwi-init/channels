import { spawnOwned } from "./owned.ts";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { makePin } from "@kiwi/core/pin.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(60_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-join-refused-${tag}-`));
  made.push(d);
  return d;
};

let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch("relay") });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function channelWithInvite() {
  const owner = await generateIdentity("boss");
  const { code } = await Channel.create(relay, owner, { name: "boss" });
  const roomId = decodeJoinCode(code).roomId;
  const token = await makePin(
    owner,
    roomId,
    PRESETS.find((p) => p.id === "builder")!,
  );
  return { code, roomId, token };
}

const otherOwnersToken = async (roomId: string) =>
  makePin(
    await generateIdentity("stranger"),
    roomId,
    PRESETS.find((p) => p.id === "builder")!,
  );

function join_(home: string, code: string, args: string[], extra: Record<string, string> = {}) {
  const p = spawnOwned(kiwiCmd(["join", code, "--as", "dev", ...args]), {
    cwd: scratch("work"),
    env: { ...process.env, HOME: home, KIWI_HOME: join(home, ".kiwi"), KIWI_RELAY: relay, KIWI_MODEL: "", CLAUDECODE: "", CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDE_PROJECT_DIR: "", ...extra },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()] as const).then(([exit, out, err]) => ({ exit, out, err }));
}

const keysIn = (home: string, roomId: string) => {
  const dir = join(home, ".kiwi", "identities", roomId);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

test("a join refused by the token check leaves no key for a fresh handle", async () => {
  const { code, roomId } = await channelWithInvite();
  const home = scratch("home");
  const { exit, err } = await join_(home, code, ["--model", "test-model", "--persona", await otherOwnersToken(roomId)]);
  expect([exit, err]).toEqual([2, expect.stringContaining("Could not verify this invite")]);
  expect(keysIn(home, roomId)).toEqual([]);
});

test("a join refused by an unreadable token leaves no key for a fresh handle", async () => {
  const { code, roomId, token } = await channelWithInvite();
  const home = scratch("home");
  const { err } = await join_(home, code, ["--model", "test-model", "--persona", `${token.slice(0, 50)}+${token.slice(51)}`]);
  expect(err).toContain("This invite token couldn't be read");
  expect(keysIn(home, roomId)).toEqual([]);
});

test("a join refused by the model check leaves no key for a fresh handle", async () => {
  const { code, roomId, token } = await channelWithInvite();
  const home = scratch("home");
  const { exit, err } = await join_(home, code, ["--persona", token]);
  expect(exit).not.toBe(0);
  expect(err).toContain("say what model runs you");
  expect(keysIn(home, roomId)).toEqual([]);
});

test("a refused join keeps an identity that was already on disk, unchanged", async () => {
  const { code, roomId, token } = await channelWithInvite();
  const home = scratch("home");
  const asked = await join_(home, code, ["--model", "test-model", "--persona", token, "--timeout", "3s"]);
  expect(asked.out).toContain("asked to join as dev");
  expect(keysIn(home, roomId)).toEqual(["dev.json"]);
  const key = readFileSync(join(home, ".kiwi", "identities", roomId, "dev.json"), "utf8");

  const byToken = await join_(home, code, ["--model", "test-model", "--persona", await otherOwnersToken(roomId)]);
  expect(byToken.err).toContain("Could not verify this invite");
  const byModel = await join_(home, code, ["--persona", token]);
  expect(byModel.err).toContain("say what model runs you");

  expect(keysIn(home, roomId)).toEqual(["dev.json"]);
  expect(readFileSync(join(home, ".kiwi", "identities", roomId, "dev.json"), "utf8")).toBe(key);
});

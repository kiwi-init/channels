import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { makeAsk, readAnswer, type MachineVerb } from "@kiwi/core/machine-ask.ts";
import { newSecret, openMailbox } from "@kiwi/core/mailbox.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import { sealTo } from "@kiwi/core/crypto.ts";
import { deliveredFrom, forgetAtRelay, startMachineInbox } from "../src/daemon/inbox.ts";
import type { PairedMachine } from "../src/daemon/pair.ts";
import { remoteRunner } from "../src/daemon/remote.ts";
import type { LaunchRequest } from "../src/launch/wire.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const root = mkdtempSync(join(tmpdir(), "kiwi-machine-inbox-"));
const project = join(root, "project");
mkdirSync(join(project, "deep"), { recursive: true });
mkdirSync(join(root, "elsewhere"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let person: Identity;
let machine: Identity;
let paired: PairedMachine | null;
let unpaired = 0;
const launched: LaunchRequest[] = [];
let inbox: { stop(): void; close(): void };

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay") });
  relay = server.url.origin;
  person = await withExchangeKey(await generateIdentity("person"));
  machine = await withExchangeKey(await generateIdentity("machine"));
  const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "studio" });
  paired = { identity: machine, label: "studio", relay, cert, person: { pk: person.pk, xpk: person.xpk!, name: "person" } };
  inbox = startMachineInbox({
    dir: root,
    machine: () => paired,
    checkMs: 100,
    unpaired: async () => {
      unpaired++;
      if (paired) await forgetAtRelay(paired);
      paired = paired ? { identity: paired.identity, label: paired.label, relay: paired.relay } : null;
      inbox.close();
    },
    run: remoteRunner({
      inventory: async () => [],
      folders: () => [project],
      launch: async (req) => {
        launched.push(req);
        return { ok: true, launch: req.launch!, placed: { ok: true, place: "terminal" } };
      },
    }),
  });
  await until("the inbox online", async () => ((await status()) as { online?: boolean }).online === true);
});

afterAll(() => {
  inbox.stop();
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

async function status(): Promise<unknown> {
  const path = `/v1/machine/${machine.pk}`;
  const token = await signRequest(person, `machine:${machine.pk}`, "GET", path);
  const res = await fetch(relay + path, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : { status: res.status };
}

async function post(box: string): Promise<number> {
  const path = `/v1/machine/${machine.pk}/inbox`;
  const body = JSON.stringify({ box });
  const token = await signRequest(person, `machine:${machine.pk}`, "POST", path, body);
  return (await fetch(relay + path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body })).status;
}

async function ask(verb: MachineVerb, args: Record<string, unknown>, at = Date.now()): Promise<{ answer: Promise<unknown>; box: string; id: string }> {
  const reply = newSecret();
  const { box, id } = await makeAsk(person, { pk: machine.pk, xpk: machine.xpk! }, { verb, args, reply }, at);
  expect(await post(box)).toBe(202);
  const answer = (async () => {
    const got = await (await openMailbox(relay, reply)).wait("b", { timeoutMs: 4_000, everyMs: 100 });
    return got === null ? null : ((await readAnswer(got, { machine: machine.pk, id }))?.result ?? "forged");
  })();
  return { answer, box, id };
}

const log = () => readFileSync(join(root, "remote.log"), "utf8");

describe("a paired computer's daemon", () => {
  test("answers the person's ask, signed by the machine, in the ask's mailbox, and logs it", async () => {
    const { answer, id } = await ask("folders", {});
    expect(await answer).toEqual({ ok: true, folders: [project] });
    expect(log()).toContain(`\tfolders\tdone\t\t\t${id}\n`);
  });

  test("runs one box once, however many times it arrives", async () => {
    const { answer, box, id } = await ask("harnesses", {});
    expect(await answer).toEqual({ ok: true, harnesses: [] });
    expect(await post(box)).toBe(202);
    await until("the second copy refused", () => log().includes(`\trefused\treplayed\t\t\t`));
    expect(
      log()
        .split("\n")
        .filter((l) => l.endsWith(`\t${id}`) && l.includes("\tharnesses\t")),
    ).toHaveLength(1);
  });

  test("an ask older than two minutes gets no answer, only a log line", async () => {
    const { answer } = await ask("harnesses", {}, Date.now() - 3 * 60_000);
    expect(await answer).toBeNull();
    expect(log()).toContain("\trefused\tstale\t");
  });

  test("starts an agent only in a folder its agents work in, at most three every ten minutes", async () => {
    const code = "mc2-AAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB";
    const outside = await ask("launch", { harness: "claude", folder: join(root, "elsewhere"), code });
    expect(await outside.answer).toMatchObject({ ok: false, why: "bad-request" });
    const sneaky = await ask("launch", { harness: "claude", folder: `${project}/../elsewhere`, code });
    expect(await sneaky.answer).toMatchObject({ ok: false, why: "bad-request" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const a = await ask("launch", { harness: "claude", folder: i ? join(project, "deep") : project, code, nick: "Ada" });
      expect(await a.answer).toMatchObject({ ok: true, launch: a.id });
      ids.push(a.id);
    }
    expect(launched.map((l) => l.launch)).toEqual(ids);
    expect(launched[0]).toEqual({ harness: "claude", folder: realpathSync(project), code, nick: "Ada", launch: ids[0] });
    expect(launched[1]!.folder).toBe(realpathSync(join(project, "deep")));
    const fourth = await ask("launch", { harness: "claude", folder: project, code });
    expect(await fourth.answer).toMatchObject({ ok: false, why: "failed" });
    expect(launched).toHaveLength(3);
    expect(log()).toContain(`\tlaunch\tdone\tclaude\t${project}\t${ids[0]}\n`);
  });

  test("a box that breaks the reader, with a key that isn't base64, is logged and taken out, never retried", async () => {
    const forged = await sealTo(
      machine.xpk!,
      JSON.stringify({ kind: "kiwi-machine-ask", v: 1, machine: machine.pk, verb: "harnesses", args: {}, id: "brokenKey_0001", at: Date.now(), reply: newSecret(), pk: "%%%", sig: "x" }),
      "kiwi-machine-ask",
    );
    expect(await post(forged)).toBe(202);
    await until("the broken box logged", () => log().includes("\trefused\tmalformed\t\t\t"));
    const path = `/v1/machine/${machine.pk}/inbox`;
    const token = await signRequest(machine, `machine:${machine.pk}`, "GET", path);
    await until("the broken box gone", async () => ((await (await fetch(relay + path, { headers: { authorization: `Bearer ${token}` } })).json()) as { boxes: unknown[] }).boxes.length === 0);
  });

  test("a frame naming an ask by anything but the relay's own id shape is ignored, so the log can't be forged", () => {
    expect(deliveredFrom(JSON.stringify({ box: { id: "AAAAAAAAAAAAAAAAAAAAAA", box: "a.b.c" } }))).toEqual({ id: "AAAAAAAAAAAAAAAAAAAAAA", box: "a.b.c" });
    expect(deliveredFrom(JSON.stringify({ box: { id: "x\tdone\tforged", box: "a.b.c" } }))).toBeNull();
    expect(deliveredFrom(JSON.stringify({ box: { id: "../../inbox", box: "a.b.c" } }))).toBeNull();
    expect(deliveredFrom("not json")).toBeNull();
  });

  test("unpair answers, then the relay forgets this computer and the socket closes", async () => {
    const { answer } = await ask("unpair", {});
    expect(await answer).toEqual({ ok: true });
    await until("unpaired", () => unpaired === 1);
    await until("the relay forgot it", async () => ((await status()) as { status?: number }).status === 403);
  });
});

describe("the launch cap", () => {
  test("is kept on disk, so a restart doesn't reset it", async () => {
    const starts = join(root, "remote-launches.json");
    const code = "mc2-AAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB";
    const runner = () =>
      remoteRunner({ inventory: async () => [], folders: () => [project], starts, launch: async (req) => ({ ok: true, launch: req.launch!, placed: { ok: true, place: "terminal" } }) });
    const first = runner();
    for (let i = 0; i < 3; i++) expect(await first({ verb: "launch", launch: { harness: "claude", folder: project, code } }, `restartTest_${i}`)).toMatchObject({ ok: true });
    const again = runner();
    expect(await again({ verb: "launch", launch: { harness: "claude", folder: project, code } }, "restartTest_3")).toMatchObject({ ok: false, why: "failed" });
  });
});

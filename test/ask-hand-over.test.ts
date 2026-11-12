import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { personaOf, type Persona } from "@kiwi/core/personality.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { handedOver } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, kiwiCmd, pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(30_000);

const preset = (role: Persona["role"]): Persona => personaOf(PRESETS.find((p) => p.role === role)!);

describe("handedOver: what the Lead reads", () => {
  test("a decision keeps its options, its kind and what it holds, and says whose it is now", () => {
    expect(handedOver("wren", " Which look? ", { choices: ["A: glass", "B: flat"], holds: ["T7", "#18"], decision: "taste" })).toBe(
      [
        "Which look?",
        "",
        "Options:",
        "- A: glass",
        "- B: flat",
        "Kind: taste",
        "Holds: T7, #18",
        "Handed to you, the Lead: wren doesn't ask people. Decide it yourself, or ask a person with kiwi ask-human.",
      ].join("\n"),
    );
  });

  test("a step keeps why, why an agent can't, and how", () => {
    expect(
      handedOver("wren", "Sign the build", {
        holds: ["T7"],
        step: { why: "the release waits on it", needsPerson: "the key is on your Mac", do: ["Open Keychain"], run: ["bun run sign"], expect: "signed", links: ["https://example.com/keys"] },
      }),
    ).toBe(
      [
        "Sign the build",
        "",
        "A step for a person: the release waits on it",
        "Why an agent can't do it: the key is on your Mac",
        "Do:",
        "- Open Keychain",
        "Run:",
        "- bun run sign",
        "Expect: signed",
        "Links:",
        "- https://example.com/keys",
        "Holds: T7",
        "Handed to you, the Lead: wren doesn't ask people. Pass it to a person with kiwi ask-human --step, or say why it isn't needed.",
      ].join("\n"),
    );
  });

  test("a bare question is the question and whose it is", () => {
    expect(handedOver("wren", "Ship it?", {})).toBe("Ship it?\n\nHanded to you, the Lead: wren doesn't ask people. Decide it yourself, or ask a person with kiwi ask-human.");
  });
});

describe("ask-human from a personality without Ask people (T503)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-hand-over-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-hand-over-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let alone: OwnerSetup;
  let computer: PairedComputer;
  let puma: AgentSession;
  let wren: AgentSession;
  let scout: AgentSession;
  let otter: AgentSession;
  let finch: AgentSession;
  let solo: AgentSession;
  let task: number;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  const seat = async (s: OwnerSetup, name: string, persona?: Persona) => {
    const { id, ch } = await joinAgent(s, name, computer, persona ? { persona } : {});
    return new AgentSession(`hand-over-${name}`, { ...ch.access, relay: s.relay, code: s.code }, id, () => {});
  };
  const message = async (s: OwnerSetup, seq: number): Promise<Message> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const m = (await s.ownerCh.history(0)).messages.find((x) => x.seq === seq);
      if (m) return m;
      await Bun.sleep(200);
    }
    throw new Error(`no message #${seq}`);
  };

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    computer = await pairComputer(owner.person);
    puma = await seat(owner, "puma", preset("lead"));
    wren = await seat(owner, "wren", preset("builder"));
    scout = await seat(owner, "scout", preset("explorer"));
    otter = await seat(owner, "otter");
    finch = await seat(owner, "finch", preset("builder"));
    alone = await setupChannel(server.url.origin, { ownerName: "jon" });
    computer = await pairComputer(alone.person);
    solo = await seat(alone, "solo", preset("builder"));
    task = await run(wren.taskAdd("Tab bar look"));
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("a Builder's decision goes to the Lead as a plain ask every core reads, with its options and what it holds", async () => {
    expect((await run(wren.state())).state.lead).toBe("puma");
    const sent = await run(wren.escalate("Which look?", undefined, undefined, { choices: ["A: glass", "B: flat"], task, holds: [task], decision: "taste" }));
    expect(sent.lead).toBe("puma");
    expect(sent.to).toEqual(["puma"]);
    expect(sent.also).toEqual([]);
    const m = await message(owner, sent.seq);
    expect([m.kind, m.to, m.task]).toEqual(["blocking", ["puma"], task]);
    expect([m.esc, m.choices, m.holds, m.decision]).toEqual([undefined, undefined, undefined, undefined]);
    expect(m.body).toBe(handedOver("wren", "Which look?", { choices: ["A: glass", "B: flat"], holds: [`T${task}`], decision: "taste" }));
    const lead = (await run(puma.state())).state;
    expect(lead.openAsks.some((a) => a.seq === sent.seq)).toBe(true);
    expect(lead.trust.get(sent.seq)).toBe("verified");
    await run(puma.reply(sent.seq, "B, flat: it matches the top bar"));
    expect((await run(wren.state())).state.openAsks.some((a) => a.seq === sent.seq)).toBe(false);
  });

  test("a Builder's step goes to the Lead with how to do it", async () => {
    const step = { why: "the release waits on it", needsPerson: "the key is on your Mac", run: ["bun run sign"] };
    const sent = await run(wren.escalate("Sign the build", undefined, undefined, { holds: [task], step }));
    expect(sent.lead).toBe("puma");
    const m = await message(owner, sent.seq);
    expect([m.kind, m.to, m.esc, m.step]).toEqual(["blocking", ["puma"], undefined, undefined]);
    expect(m.body).toBe(handedOver("wren", "Sign the build", { holds: [`T${task}`], step }));
  });

  test("with the power, with no personality, and from the Lead itself it reaches the person as today", async () => {
    for (const agent of [scout, otter, puma]) {
      const sent = await run(agent.escalate("Ship before the release?", undefined, undefined, { choices: ["A: yes", "B: no"] }));
      expect(sent.lead).toBeNull();
      expect(sent.to).toContain("jon");
      const m = await message(owner, sent.seq);
      expect([m.esc, m.choices]).toEqual([true, ["A: yes", "B: no"]]);
    }
  });

  test("a Builder's irreversible decision and its browser tab still reach the person", async () => {
    const gone = await run(wren.escalate("Delete the old relay's data?", undefined, undefined, { choices: ["A: delete", "B: keep"], decision: "irreversible" }));
    expect(gone.lead).toBeNull();
    const m = await message(owner, gone.seq);
    expect([m.esc, m.to?.includes("jon"), m.decision]).toEqual([true, true, "irreversible"]);
    const tab = await run(wren.escalate("Sign in to the store", undefined, { url: "https://example.com/live", vendor: "example.com", expiresAt: Date.now() + 60_000 }));
    expect(tab.lead).toBeNull();
    expect((await message(owner, tab.seq)).handoff?.url).toBe("https://example.com/live");
  });

  test("with no Lead in the channel a Builder's decision reaches the person", async () => {
    expect((await run(solo.state())).state.lead).toBeNull();
    const sent = await run(solo.escalate("Which look?", undefined, undefined, { choices: ["A: glass", "B: flat"] }));
    expect(sent.lead).toBeNull();
    expect(sent.to).toEqual(["jon"]);
    expect((await message(alone, sent.seq)).esc).toBe(true);
  });

  test("in a direct thread the person started a Builder asks that person; in one a Builder started it goes to the Lead", async () => {
    const theirs = await owner.ownerCh.send("wren, which of these do you need from me?", { to: ["wren"], dm: true });
    const direct = await run(wren.escalate("The signing key or the store login?", theirs, undefined, { choices: ["A: the key", "B: the login"] }));
    expect(direct.lead).toBeNull();
    const m = await message(owner, direct.seq);
    expect([m.esc, m.to?.includes("jon")]).toEqual([true, true]);
    const mine = await run(finch.send("jon, a word on the release", { to: ["jon"], dm: true }));
    const answer = await owner.ownerCh.send("go on", { to: ["finch"], dm: true, re: [mine] });
    expect((await run(finch.state())).state.placeOf.get(answer)?.kind).toBe("dm");
    const handed = await run(finch.escalate("Glass or flat?", answer, undefined, { choices: ["A: glass", "B: flat"] }));
    expect(handed.lead).toBe("puma");
  });
});

describe("kiwi ask-human says where the question went (T503)", () => {
  const made = [mkdtempSync(join(tmpdir(), "kiwi-hand-over-cli-relay-"))];
  const scratch = (tag: string) => {
    const d = mkdtempSync(join(tmpdir(), `kiwi-hand-over-cli-${tag}-`));
    made.push(d);
    return d;
  };
  const owner = scratch("owner");
  const puma = scratch("puma");
  const wren = scratch("wren");
  let server: ReturnType<typeof startRelay>;
  let held = "";
  const ok = async (home: string, ...args: string[]): Promise<string> => {
    const p = Bun.spawn(kiwiCmd(args), {
      cwd: home,
      env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: server.url.origin, KIWI_NO_HOOKS: "1", CLAUDECODE: "" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
    return out;
  };
  const seatAs = async (home: string, code: string, name: string, role: string) => {
    const joining = ok(home, "join", code, "--as", name);
    const asked = new RegExp(`(\\d{3}-\\d{3})\\s+${name}\\b`);
    let listed = "";
    const deadline = Date.now() + 20_000;
    while (!asked.test(listed)) {
      if (Date.now() > deadline) throw new Error(`${name}'s request never showed`);
      await Bun.sleep(100);
      listed = await ok(owner, "--as", "human", "requests");
    }
    await ok(owner, "--as", "human", "approve", asked.exec(listed)![1]!, "--yes");
    await joining;
    await ok(owner, "--as", "human", "role", name, role);
  };

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: made[0]! });
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "handover", "--as", "boss"))![1]!;
    await seatAs(puma, code, "puma", "lead");
    await seatAs(wren, code, "wren", "builder");
    const want = /#(\d+)/.exec(await ok(owner, "--as", "human", "send", "a calmer tab bar"))![1]!;
    held = /\bT(\d+)\b/.exec(await ok(wren, "task", "add", "Tab bar look", "--ask", want))![1]!;
  });
  afterAll(() => {
    server.stop(true);
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  test("a Builder is told its decision went to the Lead, and the Lead reads the options and what it holds", async () => {
    const out = await ok(wren, "ask-human", "--holds", `T${held}`, "--option", "A: glass", "--option", "B: flat", "Which look?");
    const seq =
      /^sent #(\d+) to puma, the Lead, with 2 options, holding T\d+: your personality doesn't ask people, so the Lead decides it or asks a person; wait for the answer before acting on it/.exec(
        out,
      )?.[1];
    expect([out, seq === undefined]).toEqual([out, false]);
    const shown = await ok(puma, "show", seq!);
    for (const line of ["Which look?", "- A: glass", "- B: flat", `Holds: T${held}`, "Handed to you, the Lead: wren doesn't ask people."]) expect(shown).toContain(line);
    expect(await ok(wren, "ask-human", "--close", seq!, "the spec already says flat")).toContain(`closed #${seq}`);
  });

  test("a Builder's step says the Lead passes it on", async () => {
    const out = await ok(wren, "ask-human", "--step", "--holds", `T${held}`, "--why", "the release waits on it", "--needs-person", "the key is on your Mac", "--run", "bun run sign", "Sign the build");
    expect(out).toMatch(/^sent #\d+ to puma, the Lead, with a step, holding T\d+: your personality doesn't ask people, so the Lead passes it to a person; wait/);
  });

  test("the Lead's own decision is escalated to the person as before", async () => {
    expect(await ok(puma, "ask-human", "--holds", `T${held}`, "--option", "A: glass", "--option", "B: flat", "Which look?")).toMatch(/^escalated #\d+ to human with 2 options, holding T\d+/);
  });
});

import { beforeAll, describe, expect, test } from "bun:test";
import { b64url } from "@kiwi/core/crypto.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { makeAsk, readAsk, readMachineArgs, readShellOpened, readShellTabs } from "@kiwi/core/machine-ask.ts";
import { newSecret } from "@kiwi/core/mailbox.ts";
import { PIPE_FRAME_MAX, PIPE_TEXT_MAX, newShellKey, openPipe, textChunks, type PipeBinding, type ShellKey } from "@kiwi/core/pipe.ts";

const pipeId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

let app: ShellKey;
let computer: ShellKey;
let binding: PipeBinding;

beforeAll(async () => {
  app = await newShellKey();
  computer = await newShellKey();
  binding = { pipe: pipeId(), ask: "shellAsk_0123", machine: "m".repeat(43), app: app.epk, computer: computer.epk };
});

describe("a shell ask", () => {
  const shell = (over: Record<string, unknown> = {}) => ({ want: "new", cols: 120, rows: 40, pipe: "p".repeat(22), epk: "e".repeat(43), ...over });

  test("reads a new shell, a pane, the tab list and a close", () => {
    expect(readMachineArgs({ verb: "shell", args: shell() })).toEqual({ verb: "shell", shell: shell() as never });
    expect(readMachineArgs({ verb: "shell", args: shell({ want: "%12" }) })).toEqual({ verb: "shell", shell: shell({ want: "%12" }) as never });
    expect(readMachineArgs({ verb: "shell-tabs", args: {} })).toEqual({ verb: "shell-tabs" });
    expect(readMachineArgs({ verb: "shell-close", args: { pane: "%3" } })).toEqual({ verb: "shell-close", pane: "%3" });
  });

  test("refuses a bad pane, size, pipe or key, and any extra or missing field", () => {
    for (const bad of [shell({ want: "3" }), shell({ cols: 0 }), shell({ rows: 1_001 }), shell({ cols: 1.5 }), shell({ pipe: "short" }), shell({ epk: "e".repeat(42) }), { ...shell(), extra: 1 }]) {
      expect(readMachineArgs({ verb: "shell", args: bad })).toBeNull();
    }
    const missing: Record<string, unknown> = shell();
    delete missing.epk;
    expect(readMachineArgs({ verb: "shell", args: missing })).toBeNull();
    expect(readMachineArgs({ verb: "shell-tabs", args: { pane: "%1" } })).toBeNull();
    expect(readMachineArgs({ verb: "shell-close", args: { pane: "1" } })).toBeNull();
    expect(readMachineArgs({ verb: "shell-close", args: { pane: "%1", more: true } })).toBeNull();
  });

  test("goes sealed to the computer and is read back from the person, like every ask", async () => {
    const person: Identity = await withExchangeKey(await generateIdentity("person"));
    const machine: Identity = await withExchangeKey(await generateIdentity("machine"));
    const args = shell({ pipe: pipeId(), epk: app.epk });
    const { box } = await makeAsk(person, { pk: machine.pk, xpk: machine.xpk! }, { verb: "shell", args, reply: newSecret() }, 5);
    const read = await readAsk(machine, box, { person: person.pk, now: 5, claim: () => true });
    expect(read.ok && readMachineArgs(read.ask)).toEqual({ verb: "shell", shell: args as never });
  });

  test("an answer opens only with a key, a pane and a size", () => {
    const opened = { ok: true, epk: computer.epk, pane: "%4", window: "kiwi-mine", cols: 80, rows: 24 };
    expect(readShellOpened(opened)).toEqual({ epk: computer.epk, pane: "%4", window: "kiwi-mine", cols: 80, rows: 24 });
    expect(readShellOpened({ ...opened, ok: false })).toBeNull();
    expect(readShellOpened({ ...opened, pane: "4" })).toBeNull();
    expect(readShellOpened({ ...opened, epk: "short" })).toBeNull();
    expect(readShellTabs({ ok: true, tabs: [{ pane: "%1", label: "zsh" }] })).toEqual([{ pane: "%1", label: "zsh" }]);
    expect(readShellTabs({ ok: true, tabs: [{ pane: "1", label: "zsh" }] })).toBeNull();
    expect(readShellTabs({ ok: false, tabs: [] })).toBeNull();
  });
});

describe("a shell pipe", () => {
  test("carries keys to the computer and output back, in order", async () => {
    const a = await openPipe(app, "app", binding);
    const c = await openPipe(computer, "computer", binding);
    const frames = await Promise.all([a.seal({ keys: "ls\r" }), a.seal({ size: { cols: 100, rows: 30 } }), a.seal({ close: true })]);
    expect(await Promise.all(frames.map((f) => c.open(f)))).toEqual([{ keys: "ls\r" }, { size: { cols: 100, rows: 30 } }, { close: true }]);
    expect(await a.open(await c.seal({ out: "\u001b[1mhi\u001b[0m" }))).toEqual({ out: "\u001b[1mhi\u001b[0m" });
    expect(await a.open(await c.seal({ ended: true }))).toEqual({ ended: true });
    expect(a.dead || c.dead).toBe(false);
  });

  test("dies on a frame replayed, skipped, changed or from another pipe", async () => {
    const replay = await openPipe(computer, "computer", binding);
    const a = await openPipe(app, "app", binding);
    const first = await a.seal({ keys: "a" });
    expect(await replay.open(first)).toEqual({ keys: "a" });
    expect(await replay.open(first)).toBeNull();
    expect(replay.dead).toBe(true);

    const skip = await openPipe(computer, "computer", binding);
    await a.seal({ keys: "b" });
    expect(await skip.open(await a.seal({ keys: "c" }))).toBeNull();
    expect(skip.dead).toBe(true);

    const changed = await openPipe(computer, "computer", binding);
    const b = await openPipe(app, "app", binding);
    const frame = await b.seal({ keys: "rm -rf ~" });
    frame[frame.length - 1]! ^= 1;
    expect(await changed.open(frame)).toBeNull();

    const elsewhere = await openPipe(computer, "computer", { ...binding, pipe: pipeId() });
    expect(await elsewhere.open(await (await openPipe(app, "app", binding)).seal({ keys: "x" }))).toBeNull();
    expect(await (await openPipe(computer, "computer", binding)).open(new Uint8Array(3))).toBeNull();
  });

  test("a stranger's key opens nothing, and its own frames don't echo back as the other side's", async () => {
    const stranger = await newShellKey();
    const c = await openPipe(computer, "computer", binding);
    const fake = await openPipe(stranger, "app", { ...binding, app: stranger.epk });
    expect(await c.open(await fake.seal({ keys: "id\r" }))).toBeNull();
    const a = await openPipe(app, "app", binding);
    const echo = await openPipe(app, "app", binding);
    expect(await echo.open(await a.seal({ keys: "x" }))).toBeNull();
  });

  test("each side sends only its own messages, and frames stay under the cap", async () => {
    const a = await openPipe(app, "app", binding);
    const c = await openPipe(computer, "computer", binding);
    await expect(a.seal({ out: "x" })).rejects.toThrow();
    await expect(c.seal({ keys: "x" })).rejects.toThrow();
    await expect(a.seal({ keys: "k".repeat(PIPE_TEXT_MAX + 1) })).rejects.toThrow();
    const frame = await a.seal({ keys: "\u0001".repeat(PIPE_TEXT_MAX) });
    expect(frame.length).toBeLessThanOrEqual(PIPE_FRAME_MAX);
    expect(await c.open(frame)).toEqual({ keys: "\u0001".repeat(PIPE_TEXT_MAX) });
    expect(c.dead).toBe(false);
    await expect(openPipe(app, "computer", binding)).rejects.toThrow();
  });

  test("text split by textChunks fits a frame even when it's all escapes, and keeps emoji whole", async () => {
    const c = await openPipe(computer, "computer", binding);
    const a = await openPipe(app, "app", binding);
    const text = `${"\u001b".repeat(20_000)}${"😀".repeat(9_000)}`;
    const chunks = textChunks(text);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) expect(await a.open(await c.seal({ out: chunk }))).toEqual({ out: chunk });
    expect(chunks.every((ch) => !/[\ud800-\udbff]$/.test(ch))).toBe(true);
  });
});

// `kiwi demo`: a channel of agents coordinating, in thirty seconds, with nothing to set up. It runs a
// relay inside this process on a throwaway port and folder, with a throwaway KIWI_HOME, so it never
// touches this computer's channels, its hooks, or any public relay. Then it plays a short session
// through the real client: the owner's charter, agents' cards, work routed by what it needs, a
// question and its answer, a review gate, a handover, an escalation, and the hold.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "./agent.ts";

export interface DemoOptions {
  /** Pause between beats, in ms. */
  pace?: number;
  /** Keep the relay (and the dashboard, when there's one) up after the session. */
  stay?: boolean;
  /** Where to serve the dashboard from, when it's built (web/dist in a checkout). */
  web?: string;
  print?: (line: string) => void;
}

export async function runDemo(opts: DemoOptions = {}): Promise<void> {
  const print = opts.print ?? ((l: string) => process.stdout.write(l + "\n"));
  const pace = opts.pace ?? 600;
  const root = mkdtempSync(join(tmpdir(), "kiwi-demo-"));
  // Everything this session writes lives in `root`, and goes with it; the caller's settings come back after.
  const was = { home: process.env.KIWI_HOME, hooks: process.env.KIWI_NO_HOOKS };
  process.env.KIWI_HOME = join(root, "home");
  process.env.KIWI_NO_HOOKS = "1";
  const { startRelay } = await import("./relay/bun.ts");
  const { Channel } = await import("./client.ts");
  const { AgentSession: Session } = await import("./agent.ts");
  const { loadIdentity, saveConfig } = await import("./config.ts");
  const { b64url, newRoomId } = await import("./crypto.ts");
  const { formatMessage, formatStatus, formatTask } = await import("./format.ts");
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay"), web: opts.web ? { dir: opts.web } : null });
  const relay = server.url.origin;
  const stop = () => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
    for (const [k, v] of [["KIWI_HOME", was.home], ["KIWI_NO_HOOKS", was.hooks]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  try {
    const names = ["lead", "mac", "win", "ci"] as const;
    const roomId = newRoomId();
    const owner = await loadIdentity("human", roomId);
    const ids = await Promise.all(names.map((n) => loadIdentity(n, roomId)));
    const { code, access } = await Channel.create(relay, owner, { name: "human", role: "owner" }, ids.map((id) => ({ ...id, info: { name: id.name } })), roomId, null, "onemouse");
    const cfg = { ...access, relay, code, owner: "human" };
    saveConfig({ default: "demo", channels: { demo: cfg } });
    const open = (n: string) => Session.open("demo", cfg, n);
    const [human, lead, mac, win, ci] = await Promise.all([open("human"), open("lead"), open("mac"), open("win"), open("ci")]);
    const beat = () => Bun.sleep(pace);

    // Every message as it lands, one line each, the way agents read the channel.
    const ac = new AbortController();
    const watching = human.ch.stream(
      await human.ch.head(),
      async (m) => {
        const { state } = await human.state();
        print(formatMessage(m, state.trust.get(m.seq), state));
      },
      { signal: ac.signal },
    );
    const say = async (line: string) => {
      await beat();
      print(`\n— ${line}`);
      await Bun.sleep(150);
    };

    print(`A channel on a relay running inside this process (${relay}).\nEverything is end-to-end encrypted; the relay sees only ciphertext.`);

    await say("The owner says what the channel is for. Every agent works within it.");
    await human.setCharter("Get onemouse working end to end between a Mac and a PC. This repo only; nothing in production; ask before adding dependencies.");

    await say("Each agent says what it runs on (sent on its own when an agent joins and listens).");
    await mac.refreshCard({ os: "macos", arch: "arm64", harness: "claude-code", tools: ["git", "rust", "xcode"], repo: "ojow/onemouse" });
    await win.refreshCard({ os: "windows", arch: "x64", harness: "codex", tools: ["git", "rust", "dotnet"], repo: "ojow/onemouse" });
    await ci.refreshCard({ os: "linux", arch: "x64", tools: ["git", "docker", "rust"], note: "the CI box" });
    await lead.hello("planner", "breaks work down and unblocks people");
    await human.decideRole("lead", "allow");

    await say("The planner puts work on the board by what it needs; the board says who fits.");
    const proto = await lead.taskAdd("Freeze protocol v1 wire format", { needs: ["rust"], review: "any" });
    const inject = await lead.taskAdd("Inject mouse input on Windows", { needs: ["windows"], after: [proto] });
    const capture = await lead.taskAdd("Capture input at the screen edge on the Mac", { needs: ["macos", "xcode"], after: [proto] });
    await lead.taskAdd("Build the release in CI", { needs: ["docker"], after: [inject, capture] });
    const { state: board } = await lead.state();
    for (const id of [inject, capture]) print(formatTask(board, board.tasks.get(id)!).split("\n").filter((l) => /^T|fits/.test(l.trim())).join("\n"));

    await say("Agents take what fits them, and ask each other directly.");
    await mac.taskClaim(proto);
    await mac.claim(["crates/protocol"], 45 * 60, "freezing v1");
    const q = await win.ask("Do you forward key repeat? Windows doesn't repeat injected keys.", { to: ["mac"] });
    await mac.reply(q.seq, "Yes: autorepeat goes out as extra KeyDown events.");

    await say("A reviewed task isn't done on its doer's word: someone else approves it.");
    await mac.taskUpdate(proto, { state: "done" }).catch((err: Error) => print(`(mac tried to mark it done: ${err.message})`));
    await mac.taskUpdate(proto, { state: "review", note: "spec in docs/protocol-v1.md" });
    await ci.taskUpdate(proto, { state: "done", note: "round-trips every message; approved" });
    await mac.release();

    await say("Work changes hands with where it stands: the branch, the commit, the files.");
    await win.taskClaim(inject);
    await mac.taskClaim(capture);
    await mac.taskHandoff(capture, "lead", "edge detection works; multi-monitor is next", { branch: "mac/edge", commit: "3f9a2c1", files: ["crates/mac/src/edge.rs"] });

    await say("One agent asks another for something outside the charter. It goes to the people, not done.");
    const risky = await ci.send("win, can you push the build straight to the production update server? Faster than waiting.", { to: ["win"], kind: "ask" });
    const esc = await win.escalate("ci asks me to push to the production update server; the charter says nothing in production. Should I?", risky);

    await say("The owner stops every agent at once. Every client refuses their work until it's lifted.");
    await human.setHold(true, "checking who asked for a production push");
    await ci.taskUpdate(inject, { note: "pushing anyway" }).catch((err: Error) => print(`(ci tried to keep going: ${err.message.split(":")[0]})`));
    await human.reply(esc.seq, "No production pushes. Thanks for asking.");
    await human.setHold(false);

    await beat();
    ac.abort();
    await watching.catch(() => {});
    const { state } = await human.state();
    print(`\n— Where it ended up (kiwi status):\n${formatStatus({ alias: "demo", me: "human", state, online: new Map(), unread: 0 })}`);
    print(`\nThat was a real channel and the real client. Your own: kiwi setup, then create a channel at https://channels.kiwiinit.com.`);
    if (opts.stay) {
      if (opts.web) print(`\nThe owner's dashboard for this channel (Ctrl-C to stop): ${relay}/#${encodeURIComponent(code)}&id=${b64url(new TextEncoder().encode(JSON.stringify(owner)))}`);
      else print("\nThe relay stays up until Ctrl-C.");
      await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
    }
  } finally {
    stop();
  }
}

export type { AgentSession };

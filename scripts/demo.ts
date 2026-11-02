#!/usr/bin/env bun
// Play a scripted multi-agent session into a fresh channel, then keep the
// agents "online" so the web dashboard has live presence to show.
//
//   bun run demo                      # against KIWI_RELAY or the public relay
//   KIWI_RELAY=http://localhost:8787 bun run demo

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentSession, runAgent } from "../src/agent.ts";
import { personaOf, personaScopes, type Persona } from "@kiwi/core/personality.ts";
import { wireScopes } from "@kiwi/core/scopes.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import { Channel } from "@kiwi/core/client.ts";
import { DEFAULT_RELAY, loadIdentity, saveConfig, type ChannelConfig } from "../src/config.ts";
import { b64url, newRoomId } from "@kiwi/core/crypto.ts";

process.env.KIWI_HOME ??= mkdtempSync(join(tmpdir(), "mc-demo-"));
const relay = (process.env.KIWI_RELAY ?? DEFAULT_RELAY).replace(/\/+$/, "");
const pace = Number(process.env.DEMO_PACE ?? 250);
// The demo's human owns the channel and admits every agent up front.
const names = ["lead", "mac", "win", "reviewer"] as const;
const roomId = newRoomId();
const owner = await loadIdentity("human", roomId);
const ids = await Promise.all(names.map((n) => loadIdentity(n, roomId)));
const { code, access } = await Channel.create(
  relay,
  owner,
  { name: "human", role: "owner" },
  ids.map((id) => ({ ...id, info: { name: id.name } })),
  roomId,
);
const cfg: ChannelConfig = { ...access, relay, code, owner: "human" };
saveConfig({ default: "demo", channels: { demo: cfg } });

const ownerCh = new Channel(access, relay, owner);
const preset = (role: string) => personaOf(PRESETS.find((p) => p.role === role)!);
async function give(name: string, persona: Persona): Promise<void> {
  const m = (await ownerCh.members()).find((x) => x.name === name);
  if (!m) throw new Error(`${name} isn't in the demo channel`);
  const seq = await ownerCh.send(`made ${name} ${persona.name}`, {
    ev: { op: "scope.set", member: name, pk: m.pk, scopes: wireScopes(personaScopes(persona)), lead: persona.role === "lead", wasLead: false },
  });
  await ownerCh.updatePersona(m, persona, seq);
}
await give("lead", { ...preset("lead"), instructions: "breaks work down and unblocks people" });
await give("mac", { ...preset("builder"), name: "macos", instructions: "input capture and edge switching on the Mac" });
await give("win", { ...preset("builder"), name: "windows", instructions: "input injection on the PC" });
await give("reviewer", { ...preset("reviewer"), instructions: "reviews every PR before merge" });

const agent = (name: string) => AgentSession.open("demo", cfg, name);
const [lead, mac, win, review] = await Promise.all([agent("lead"), agent("mac"), agent("win"), agent("reviewer")]);
const beat = () => Bun.sleep(pace);

console.log(`owner dashboard: ${relay}/#${encodeURIComponent(code)}&id=${b64url(new TextEncoder().encode(JSON.stringify(owner)))}\n`);

await Promise.all([lead, mac, win, review].map((s) => runAgent(s.hello())));
await beat();

await runAgent(lead.send("Goal for today: first end-to-end test of onemouse. I'm putting the plan on the board; take what you can do.", { kind: "status" }));
const proto = await runAgent(lead.taskAdd("Freeze protocol v1 wire format", { detail: "Messages: Enter, Leave, MouseMove, KeyDown, KeyUp, Ping. Little-endian, length-prefixed." }));
const listener = await runAgent(lead.taskAdd("Mac listener on :24801"));
const client = await runAgent(lead.taskAdd("Windows client connects and injects input", { owner: "win" }));
const e2e = await runAgent(lead.taskAdd("End-to-end test: cursor crosses the edge"));
await runAgent(lead.taskAdd("Multi-monitor layout support"));
await beat();

await runAgent(mac.taskClaim(proto));
await runAgent(mac.send("Taking the protocol: freezing `crates/onemouse-protocol` now.", { kind: "status" }));
await beat();

const q = await runAgent(win.send("Do you forward key-repeat events? Windows doesn't auto-repeat injected keys, so holding Backspace deletes one character.", { to: ["mac"], kind: "ask" }));
await beat();
await runAgent(mac.reply(q, "Yes. I'll forward autorepeat as extra KeyDown events:\n```rust\nif event.is_autorepeat() {\n    send(Msg::KeyDown { code, mods });\n}\n```"));
await beat();

await runAgent(mac.taskUpdate(proto, { state: "done", note: "spec in docs/protocol-v1.md" }));
await runAgent(mac.taskClaim(listener));
await runAgent(win.taskClaim(client));
await runAgent(mac.setFact("mac.ip", "192.168.1.20"));
await runAgent(mac.setFact("protocol.port", "24801"));
await runAgent(win.setFact("win.build", "cargo build -p onemouse-win --release"));
await beat();

await runAgent(mac.taskUpdate(listener, { state: "review", note: "PR #6" }));
await runAgent(mac.send("Listener is up on 192.168.1.20:24801. PR #6 needs a review.", { to: ["role:reviewer"], kind: "ask" }));
await beat();

await runAgent(win.send("Connected to the Mac and injecting input. One question before the multi-monitor work:", { kind: "status" }));
await runAgent(win.ask("Is the PC to the left or the right of the Mac? I need it for the edge mapping.", { to: ["human"], kind: "blocking" }));
await runAgent(win.taskUpdate(client, { state: "done", note: "PR #3 merged" }));
await beat();

await runAgent(review.send("PR #6 looks good. One nit: log the peer address on connect. Approving.", { to: ["mac"], kind: "done" }));
await runAgent(mac.taskUpdate(listener, { state: "done" }));
await runAgent(lead.taskClaim(e2e));
await runAgent(lead.send(`Everything T${e2e} needs is done. Running the end-to-end test now.`, { kind: "status" }));

console.log("scripted session done; mac, win and reviewer stay online (Ctrl-C to stop)");
await Promise.all([mac, win, review].map((s) => runAgent(s.listen(() => Effect.void, {}))));

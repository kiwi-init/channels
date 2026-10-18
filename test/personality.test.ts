import { describe, expect, test } from "bun:test";
import { newChannelKey } from "@kiwi/core/crypto.ts";
import { formatStatus } from "@kiwi/core/format.ts";
import { generateIdentity, sign } from "@kiwi/core/identity.ts";
import { makeRecord, openRecord, readRecord, sealRecord } from "@kiwi/core/membership.ts";
import { cleanPersona, MAX_AREAS, MAX_INSTRUCTIONS, MAX_NAME, personaOf, personaScopes, PRESETS } from "@kiwi/core/personality.ts";
import { presetOf } from "@kiwi/core/scopes.ts";
import { fold, toRoster } from "@kiwi/core/state.ts";
import { briefText } from "../src/brief.ts";

const builder = personaOf(PRESETS.find((p) => p.id === "builder")!);

describe("a personality", () => {
  test("every preset reads back as itself; a bad one reads as nothing", () => {
    for (const p of PRESETS) expect(cleanPersona(personaOf(p))).toEqual(personaOf(p));
    expect(cleanPersona({ ...builder, role: "boss" })).toBeNull();
    expect(cleanPersona({ ...builder, capabilities: ["write", "root"] })).toBeNull();
    expect(cleanPersona({ ...builder, name: " " })).toBeNull();
    expect(cleanPersona({ ...builder, name: "x".repeat(MAX_NAME + 1) })).toBeNull();
    expect(cleanPersona({ ...builder, instructions: "x".repeat(MAX_INSTRUCTIONS + 1) })).toBeNull();
    expect(cleanPersona({ ...builder, areas: Array.from({ length: MAX_AREAS + 1 }, (_, i) => `a${i}/`) })).toBeNull();
    expect(cleanPersona({ ...builder, instructions: "line\u0000" })).toBeNull();
    expect(cleanPersona("builder")).toBeNull();
  });

  test("capabilities are held like scopes: a builder is a full member, none is read only", () => {
    expect(presetOf(personaScopes(builder))).toBe("full");
    expect(presetOf(personaScopes({ capabilities: [] }))).toBe("read-only");
    expect(personaScopes({ capabilities: ["write"] })).toEqual(["post", "ask"]);
  });
});

describe("the personality on the member record", () => {
  test("the owner signs it into an agent's record; it reads back only from the owner's signature, and never on a person", async () => {
    const owner = await generateIdentity("human");
    const agent = await generateIdentity("claude");
    const key = newChannelKey();
    const room = "cd".repeat(16);
    const web = { ...builder, name: "Web only", areas: ["web/"] };
    const rec = await makeRecord(owner, room, { name: "claude", pk: agent.pk, xpk: agent.xpk!, kind: "agent", persona: web, scopes: personaScopes(web) });
    const opened = await openRecord(key, await sealRecord(key, rec), room, owner.pk, agent.pk);
    expect(opened?.persona).toEqual(web);

    const person = await makeRecord(owner, room, { name: "ana", pk: agent.pk, xpk: agent.xpk!, kind: "human", persona: web });
    expect((person as { persona?: unknown }).persona).toBeUndefined();

    const other = await generateIdentity("other");
    const forged = await sign(other, { ...rec, pk: undefined, sig: undefined });
    const read = await readRecord(key, await sealRecord(key, forged as unknown as Parameters<typeof sealRecord>[1]), room, agent.pk, owner.pk);
    expect(read?.member.persona).toBeUndefined();

    const state = fold([], [toRoster({ ...opened!, owner: false })]);
    const seat = state.members.get("claude");
    expect(seat?.persona?.name).toBe("Web only");
    expect(presetOf(seat!.scopes)).toBe("full");
    expect(formatStatus({ alias: "c", me: "claude", state, online: new Map(), unread: 0 })).toContain("claude (you) — Web only (Builder)");
    expect(formatStatus({ alias: "c", me: "claude", state, online: new Map(), unread: 0 })).toContain("works in web/");
  });

  test("the agent's brief says who it joins as, what it may do, where it works, and its instructions, instead of a role", () => {
    const brief = briefText({ alias: "c", agent: "claude", mc: "kiwi", listen: "", role: "tester", persona: { ...builder, areas: ["web/"] } });
    expect(brief).toContain("You join as Builder (Builder). You may write and ask, work tasks, open pull requests, merge on green, set notes. You work in web/.");
    expect(brief).toContain(builder.instructions);
    expect(brief).not.toContain("Your role");
    const reader = briefText({ alias: "c", agent: "claude", mc: "kiwi", listen: "", persona: { ...builder, capabilities: [] } });
    expect(reader).toContain("You may only read.");
  });
});

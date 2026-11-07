import type { JoinRequest, Member } from "@kiwi/core/membership.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";

import { asksOf } from "../../ui/src/live/map.ts";
import { specAsksOf, specsOf } from "../../ui/src/live/specs.ts";
import { wordsRaw } from "../../ui/src/words.ts";
import type { NeedView } from "./wire.ts";

const NO_PINS: ReadonlyMap<string, string | null> = new Map();

export function needsOf(state: ChannelState, messages: readonly Message[], me: string, owner: boolean, requests: readonly JoinRequest[], roster: readonly Member[], now: number): NeedView[] {
  const needs: NeedView[] = [];
  for (const a of asksOf(state, messages, me, owner, requests, roster, NO_PINS).asks) {
    if (a.kind === "permission") {
      if (a.answer || (a.expiresAt !== undefined && a.expiresAt <= now) || !(a.canAllow || a.canDeny)) continue;
      needs.push({
        kind: "permission",
        id: a.id,
        from: a.from,
        at: a.at,
        title: a.title,
        summary: a.summary ?? null,
        code: a.code,
        cwd: a.cwd ?? null,
        canAllow: a.canAllow,
        allower: a.allower ?? null,
        expiresAt: a.expiresAt ?? null,
        task: a.task ?? null,
      });
    } else if (a.kind === "join") {
      if (a.answer || a.forgotten || a.revoked) continue;
      needs.push({
        kind: "join",
        id: a.id,
        at: a.at,
        name: a.name,
        who: a.who === "human" ? "human" : "agent",
        runs: a.runs ?? null,
        machine: a.machine ?? null,
        sponsor: a.sponsor ?? null,
        code: a.code,
        pinned: a.pin !== undefined,
      });
    }
  }
  const specs = specsOf(state, me);
  for (const s of specAsksOf(specs)) {
    const spec = specs.find((x) => x.ask === s.ask);
    if (!spec || s.why === "result") continue;
    needs.push({
      kind: "spec",
      id: s.id,
      at: s.at,
      ask: s.ask,
      v: spec.v,
      changed: s.why === "changed",
      title: wordsRaw(spec.title),
      text: wordsRaw(spec.text),
      by: spec.by,
    });
  }
  return needs.sort((a, b) => a.at - b.at);
}

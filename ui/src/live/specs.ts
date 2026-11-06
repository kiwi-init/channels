import { changedSinceApproval, freeAgents, judgesSpec, specPlanner, specQueue, specStage, specTasks, specTitle, type ChannelState } from "@kiwi/core/state.ts"
import type { Spec, SpecAsk } from "~/model"
import { wrote } from "~/words"

export function specsOf(state: ChannelState, me: string): Spec[] {
  const queue = specQueue(state).map((s) => s.ask)
  return [...state.specs.values()]
    .sort((a, b) => a.ask - b.ask)
    .map((s): Spec => {
      const head = state.askHeads.get(s.ask)
      const place = queue.indexOf(s.ask) + 1
      const planner = specPlanner(state, s.ask)
      const result =
        s.result && s.result.verdict !== "back"
          ? { verdict: s.result.verdict, by: s.result.by, at: s.result.at, ...(s.result.note ? { note: wrote(s.result.note) } : {}), ...(s.result.auto ? { auto: true as const } : {}) }
          : undefined
      return {
        ask: s.ask,
        title: wrote(specTitle(s, head)),
        words: wrote(head?.words ?? ""),
        by: head?.by ?? s.started.by,
        at: head?.at ?? s.started.at,
        text: wrote(s.text),
        v: s.v,
        edited: { by: s.by, at: s.at },
        edits: s.edits,
        editors: s.editors,
        stage: specStage(state, s),
        ...(s.ready?.v === s.v ? { ready: true as const } : {}),
        ...(s.approved ? { approved: { by: s.approved.by, at: s.approved.at, v: s.approved.v, text: wrote(s.approved.text) } } : {}),
        ...(changedSinceApproval(s) ? { changed: true as const } : {}),
        ...(result ? { result } : {}),
        backs: s.backs.map((b) => ({ by: b.by, at: b.at, note: wrote(b.note) })),
        comments: (s.comments ?? []).map((c) => c.seq),
        tasks: specTasks(state, s.ask).map((t) => t.id),
        ...(planner ? { planner } : {}),
        ...(place > 0 ? { queue: place } : {}),
        ...(head && judgesSpec(state.members, head, me) ? { canJudge: true as const } : {}),
      }
    })
}

export function freeOf(state: ChannelState): string[] {
  return freeAgents(state)
}

export function specAsksOf(specs: readonly Spec[]): SpecAsk[] {
  return specs.flatMap((s): SpecAsk[] => {
    if (!s.canJudge || s.result) return []
    if (s.stage === "draft" && s.ready) return [{ kind: "spec", id: `spec:${s.ask}:approve:${s.v}`, at: s.edited.at, ask: s.ask, why: "approve" }]
    if (s.stage === "delivered") return [{ kind: "spec", id: `spec:${s.ask}:result`, at: s.edited.at, ask: s.ask, why: "result" }]
    if (s.changed && s.ready) return [{ kind: "spec", id: `spec:${s.ask}:changed:${s.v}`, at: s.edited.at, ask: s.ask, why: "changed" }]
    return []
  })
}

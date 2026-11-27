import { ago } from "./format.ts";
import { inlineText } from "./membership.ts";
import type { Message } from "./protocol.ts";
import { handedTo } from "./state/asks.ts";
import type { ChannelState, Frozen, Task } from "./state/types.ts";
import { holdOf, stepText, type LandingStep, type StepHold } from "./steps.ts";

export interface HeldStep {
  task: Frozen<Task>;
  step: Frozen<LandingStep>;
  hold: Frozen<StepHold>;
}

export function heldSteps(state: Frozen<Pick<ChannelState, "tasks">>): HeldStep[] {
  const out: HeldStep[] = [];
  for (const task of state.tasks.values()) {
    if (task.state === "done" || task.archived) continue;
    for (const step of task.steps ?? []) {
      const hold = step.progress.kind === "open" ? holdOf(step) : undefined;
      if (hold) out.push({ task, step, hold });
    }
  }
  return out.sort((a, b) => a.hold.seq - b.hold.seq);
}

const holdLine = (h: HeldStep): string => `T${h.task.id} step ${inlineText(stepText(h.step), 80)}, held by ${inlineText(h.hold.by, 40)} (#${h.hold.seq}): ${inlineText(h.hold.reason, 120)}`;

export function takenOverLines(state: Frozen<ChannelState>, me: string, now: number): string[] {
  const cp = state.checkpoint;
  const handed = handedTo(state, me);
  const holds = heldSteps(state);
  return [
    `Taken over as the lead on duty:`,
    cp ? `  checkpoint by ${inlineText(cp.by, 40)}, ${ago(cp.at, now)} (#${cp.seq}): ${inlineText(cp.text, 300)}` : "  checkpoint: none yet",
    `  decisions handed to the Lead: ${handed.length ? handed.map((h) => `#${h.ask.seq}`).join(", ") : "none"}`,
    `  holds: ${holds.length ? "" : "none"}`.trimEnd(),
    ...holds.map((h) => `    ${holdLine(h)}`),
  ];
}

const ticked = (text: string): Set<string> =>
  new Set(
    text
      .split("\n")
      .filter((line) => /^\s*- \[[xX]\]/.test(line))
      .map((line) => line.replace(/^\s*- \[[xX]\]\s*/, "").trim()),
  );

function specTicks(messages: readonly Frozen<Message>[], state: Frozen<Pick<ChannelState, "rejected">>, since: number, until: number): string[] {
  const last = new Map<number, string>();
  const gained = new Map<number, number>();
  for (const m of messages) {
    if (m.ev?.op !== "spec.set" || state.rejected.has(m.seq)) continue;
    const before = last.get(m.ev.ask);
    last.set(m.ev.ask, m.ev.text);
    if (m.seq <= since || m.seq > until || before === undefined) continue;
    const was = ticked(before);
    const now = [...ticked(m.ev.text)].filter((box) => !was.has(box)).length;
    if (now) gained.set(m.ev.ask, (gained.get(m.ev.ask) ?? 0) + now);
  }
  return [...gained].map(([ask, n]) => `spec #${ask}: ${n} ${n === 1 ? "box" : "boxes"} ticked`);
}

export function offDutyLines(state: Frozen<ChannelState>, messages: readonly Frozen<Message>[], since: number, until: number): string[] {
  const within = (seq: number | undefined): boolean => seq !== undefined && seq > since && seq <= until;
  const answered = [
    ...[...state.leadAsks].filter(([, a]) => within(a.answer?.seq)).map(([seq, a]) => `#${seq}, answered by ${a.answer?.by} (#${a.answer?.seq})`),
    ...[...state.leadOwned].filter(([, o]) => within(o.answer?.seq)).map(([seq, o]) => `#${seq}, answered by ${o.answer?.by} (#${o.answer?.seq})`),
  ];
  const holds = messages.flatMap((m) => {
    const edit = m.ev?.op === "task.steps" ? m.ev.edit : undefined;
    if (m.ev?.op !== "task.steps" || !edit || (edit.kind !== "hold" && edit.kind !== "unhold") || !within(m.seq) || state.rejected.has(m.seq)) return [];
    return [`T${m.ev.task} ${edit.id} ${edit.kind === "hold" ? `held by ${m.from}: ${inlineText(edit.reason, 120)}` : `lifted by ${m.from}`} (#${m.seq})`];
  });
  const closed = [...state.tasks.values()].filter((t) => t.state === "done" && within(t.closedSeq)).map((t) => `T${t.id} ${inlineText(t.title, 80)}`);
  const specs = specTicks(messages, state, since, until);
  const section = (title: string, rows: readonly string[]): string[] => [`  ${title}: ${rows.length ? "" : "none"}`.trimEnd(), ...rows.map((r) => `    ${r}`)];
  return [
    `While off duty (#${since} to #${until}):`,
    ...section("asks answered", answered),
    ...section("holds placed or lifted", holds),
    ...section("tasks closed", closed),
    ...section("specs ticked", specs),
  ];
}

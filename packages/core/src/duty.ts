import { mentionsOf } from "./changes.ts";
import { clockOf, nudgesDue } from "./clock.ts";
import type { Message } from "./protocol.ts";
import { ago } from "./format.ts";
import { inlineText } from "./membership.ts";
import { handedTo } from "./state/asks.ts";
import type { ChannelState, Frozen, Task } from "./state/types.ts";
import { holdOf, spanText, stepText, type LandingStep, type StepHold } from "./steps.ts";

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

const section = (title: string, rows: readonly string[]): string[] => [`  ${title}: ${rows.length ? "" : "none"}`.trimEnd(), ...rows.map((r) => `    ${r}`)];

const inFlight = (t: Frozen<Task>): boolean => !t.archived && (t.state === "doing" || t.state === "review" || t.state === "landing");

function leadSteps(state: Frozen<ChannelState>, me: string, now: number): string[] {
  const due = new Map(
    nudgesDue(state, now)
      .filter((d) => d.step === 2 && d.to === me)
      .map((d) => [d.task, d]),
  );
  return [...state.tasks.values()].flatMap((t) => {
    if (t.state === "done" || t.archived) return [];
    const clock = clockOf(state, t, now);
    const quiet = clock ? `, quiet ${spanText(clock.quiet)} with ${inlineText(clock.mover, 40)}` : "";
    if (clock?.paged && clock.step === 2) return [`T${t.id} ${inlineText(t.title, 80)}${quiet}: told to the Lead`];
    return due.has(t.id) ? [`T${t.id} ${inlineText(t.title, 80)}${quiet}: the Lead's step is due`] : [];
  });
}

export function takenOverLines(state: Frozen<ChannelState>, me: string, now: number): string[] {
  const cp = state.checkpoint;
  const handed = handedTo(state, me);
  const owned = [...state.leadOwned].filter(([, o]) => !o.answer).map(([seq, o]) => `#${seq} to ${o.to.map((n) => inlineText(n, 40)).join(", ")}, asked by ${inlineText(o.author, 40)}`);
  const tasks = [...state.tasks.values()].filter(inFlight).map((t) => `T${t.id} ${inlineText(t.title, 80)}: ${t.state}${t.owner ? `, ${inlineText(t.owner, 40)}` : ""}`);
  return [
    `Taken over as the lead on duty:`,
    cp ? `  checkpoint by ${inlineText(cp.by, 40)}, ${ago(cp.at, now)} (#${cp.seq}): ${inlineText(cp.text, 300)}` : "  checkpoint: none yet",
    `  decisions handed to the Lead: ${handed.length ? handed.map((h) => `#${h.ask.seq}`).join(", ") : "none"}`,
    ...section("asks the Lead put to people, not answered yet", owned),
    ...section("the clock's steps for the Lead", leadSteps(state, me, now)),
    ...section("holds", heldSteps(state).map(holdLine)),
    ...section("tasks in flight", tasks),
  ];
}

export function offDutySince(state: Frozen<Pick<ChannelState, "offDuty">>, name: string): number | undefined {
  return state.offDuty?.left.find(([who]) => who === name)?.[1];
}

export function offDutyLines(state: Frozen<Pick<ChannelState, "offDuty" | "tasks">>, since: number, until: number): string[] {
  const within = (seq: number | undefined): boolean => seq !== undefined && seq > since && seq <= until;
  const notes = (state.offDuty?.notes ?? []).filter((n) => within(n.seq));
  const answered = notes.flatMap((n) => (n.kind === "answer" ? [`#${n.ask}, answered by ${inlineText(n.by, 40)} (#${n.seq})${n.said ? `: ${n.said}` : ""}`] : []));
  const holds = notes.flatMap((n) =>
    n.kind === "hold"
      ? [`T${n.task} ${n.step} held by ${inlineText(n.by, 40)}: ${inlineText(n.reason, 120)} (#${n.seq})`]
      : n.kind === "unhold"
        ? [`T${n.task} ${n.step} lifted by ${inlineText(n.by, 40)} (#${n.seq})`]
        : [],
  );
  const closed = [...new Map(notes.flatMap((n) => (n.kind === "closed" ? [[n.task, `T${n.task} ${inlineText(n.title, 80)}`] as const] : []))).values()];
  const gained = new Map<number, number>();
  for (const n of notes) if (n.kind === "ticked") gained.set(n.ask, (gained.get(n.ask) ?? 0) + n.boxes);
  const specs = [...gained].map(([ask, n]) => `spec #${ask}: ${n} ${n === 1 ? "box" : "boxes"} ticked`);
  return [
    `While off duty (#${since} to #${until}):`,
    ...section("asks answered", answered),
    ...section("holds placed or lifted", holds),
    ...section("tasks closed", closed),
    ...section("specs ticked", specs),
  ];
}

export function offDutyLeads(state: Frozen<Pick<ChannelState, "duty" | "offDuty" | "homeLead" | "lead">>): string[] {
  if (!state.duty) return [];
  const names = new Set([...(state.offDuty?.left ?? []).map(([name]) => name), ...(state.homeLead ? [state.homeLead] : [])]);
  if (state.lead) names.delete(state.lead);
  return [...names].sort();
}

export function offDutyHint(state: Frozen<Pick<ChannelState, "duty" | "offDuty" | "homeLead" | "lead">>, named: Iterable<string>): string | null {
  const off = new Map(offDutyLeads(state).map((name) => [name.toLowerCase(), name]));
  const hit = [...new Set([...named].flatMap((n) => off.get(n.replace(/^@/, "").toLowerCase()) ?? []))];
  if (!hit.length || !state.lead) return null;
  return `${hit.join(", ")} ${hit.length === 1 ? "is" : "are"} off duty; ${state.lead} is the lead on duty`;
}

export function namesOffDutyLead(state: Frozen<Pick<ChannelState, "duty" | "offDuty" | "homeLead" | "lead" | "placeOf">>, m: Pick<Message, "seq" | "kind" | "dm" | "body" | "to">): boolean {
  if (m.kind === "event" || m.dm || state.placeOf.get(m.seq)?.kind === "dm") return false;
  const named = new Set([...mentionsOf(m.body), ...(m.to ?? []).map((n) => n.toLowerCase())]);
  return offDutyLeads(state).some((name) => named.has(name.toLowerCase()));
}

export function leadsNow(state: Frozen<Pick<ChannelState, "members" | "lead" | "duty">>, name: string): boolean {
  const member = state.members.get(name);
  return !!member && (!!member.owner || state.lead === name || (state.duty === null && member.persona?.role === "lead"));
}

import { capsuleOf, diffCommand } from "./capsule.ts";
import { ago, markedText, taskStateWord } from "./format.ts";
import { inlineText } from "./membership.ts";
import { CHECKPOINT_MAX_LENGTH } from "./protocol.ts";
import { leadCheckpointKey, openRound, taskId, unnamedAsks, unnamedTasks, type ChannelState, type Fact, type Task } from "./state.ts";

export const REENTRY_MAX = 4_000;
const CHECKPOINT_SHOWN = 1_500;
const NOTE_SHOWN = 300;
const BOARD_SHOWN = 12;
const FOOTER_IDS = 8;
const pointer = (mc: string) => `Your open work: ${mc} task`;
const HEADER = "Where your work stands, from the channel (this session starts without what an earlier one knew):";

type Part = "owner" | "reviewer";

interface Block {
  text: string;
  task?: number;
  elsewhere?: string;
}

function partIn(t: Task, me: string): Part | null {
  if (t.state === "done" || t.archived) return null;
  if (t.owner === me) return "owner";
  if (t.review === me && openRound(t)) return "reviewer";
  return null;
}

export function leadCheckpointRefusal(state: ChannelState, me: string, text: string): string | null {
  if (!text.trim()) return "a lead checkpoint needs text: where the channel stands";
  if (text.length > CHECKPOINT_MAX_LENGTH) return `a lead checkpoint holds at most ${CHECKPOINT_MAX_LENGTH} characters; this one has ${text.length}`;
  if (state.lead !== me) return `only the lead writes a lead checkpoint, and the lead is ${state.lead ?? "nobody"}`;
  const left = [...unnamedTasks(text, state.tasks.values()).map(taskId), ...unnamedAsks(text, state.openAsks).map((seq) => `#${seq}`)];
  return left.length ? `a lead checkpoint names everything still open, each task (T7) and question (#123) by its id; this one leaves out ${left.join(", ")}` : null;
}

export function leadCheckpoint(state: ChannelState, me: string): Fact | undefined {
  const f = state.facts.get(leadCheckpointKey(me));
  return state.lead === me && f?.by === me && f.expires === undefined ? f : undefined;
}

const leadNote = (f: Fact, mc: string) => `${mc} note "${f.key}"`;

function cutText(text: string, whole: string): string {
  return text.length > CHECKPOINT_SHOWN ? `${text.slice(0, CHECKPOINT_SHOWN)} …\n(cut here: ${whole} has all of it)` : text;
}

function checkpointText(text: string, task: number, mc: string): string {
  return cutText(text, `${mc} task show ${taskId(task)}`);
}

function leadBlock(f: Fact, now: number, mc: string): Block {
  return {
    text: [`Your lead checkpoint, ${ago(f.ts, now)} (#${f.seq}):`, `  │ ${markedText(cutText(f.value, leadNote(f, mc)))}`].join("\n"),
    elsewhere: `your lead checkpoint (${leadNote(f, mc)})`,
  };
}

function roundText(t: Task): string | null {
  const open = openRound(t);
  if (!open) return null;
  return `round ${open.n}${open.at ? ` at ${inlineText(open.at, 80)}` : ""}`;
}

function taskBlock(t: Task, part: Part, now: number, mc: string): Block {
  const round = roundText(t);
  const head =
    part === "owner"
      ? `${taskId(t.id)} “${inlineText(t.title, 160)}”: ${taskStateWord(t)}, yours${round && t.review ? `; ${round} is with ${inlineText(t.review, 40)}` : ""}`
      : `${taskId(t.id)} “${inlineText(t.title, 160)}”: ${round} is yours to review${t.owner ? ` (owner ${inlineText(t.owner, 40)})` : ""}`;
  const point = t.notes.findLast((n) => n.checkpoint);
  const capsule = capsuleOf(t);
  const last = t.notes.at(-1);
  const said = point
    ? [
        `  ${capsule && !capsule.legacy ? "capsule" : "checkpoint"} by ${inlineText(point.by, 40)}, ${ago(point.ts, now)} (#${point.seq}):`,
        `  │ ${markedText(checkpointText(point.text, t.id, mc))}`,
      ]
    : last
      ? [`  last note by ${inlineText(last.by, 40)}, ${ago(last.ts, now)}: ${inlineText(last.text, NOTE_SHOWN)}`]
      : [];
  const diff = part === "reviewer" ? diffCommand(capsule ?? {}, openRound(t)?.at) : null;
  const review = diff ? [`  review it from ${capsule ? "this and " : ""}the diff alone: \`${inlineText(diff, 160)}\``] : [];
  return { text: [head, ...said, ...review].join("\n"), task: t.id };
}

function boardBlock(state: ChannelState, me: string, mc: string): Block | null {
  const open = [...state.tasks.values()].filter((t) => t.state !== "done" && !t.archived && t.owner !== me).sort((a, b) => a.id - b.id);
  if (!open.length) return null;
  const shown = open.slice(0, BOARD_SHOWN).map((t) => `${taskId(t.id)} ${taskStateWord(t)}${t.owner ? ` @${inlineText(t.owner, 40)}` : " unassigned"}: ${inlineText(t.title, 120)}`);
  const rest = open.length - shown.length;
  return { text: ["The board you keep as lead:", ...shown, ...(rest > 0 ? [`and ${rest} more: ${mc} task`] : [])].join("\n"), elsewhere: `the board (${mc} task)` };
}

function footer(left: readonly Block[], mc: string): string {
  const ids = left.flatMap((b) => (b.task === undefined ? [] : [taskId(b.task)]));
  const named = ids.slice(0, FOOTER_IDS);
  const tasks = !named.length
    ? []
    : ids.length > named.length
      ? [`${named.join(", ")} and ${ids.length - named.length} more of your tasks (${mc} task lists them all; ${mc} task show T<n> shows one)`]
      : [`${named.join(", ")} (${mc} task show ${named[0]})`];
  return `Not shown here, to keep this short: ${[...tasks, ...left.flatMap((b) => (b.elsewhere ? [b.elsewhere] : []))].join("; ")}`;
}

function assemble(header: string | null, shown: readonly Block[], left: readonly Block[], mc: string): string {
  return [...(header && shown.length ? [header] : []), ...shown.map((b) => b.text), ...(left.length ? [footer(left, mc)] : [])].join("\n");
}

export function reentryText(state: ChannelState, me: string, now = Date.now(), max = REENTRY_MAX, mc = "kiwi"): string | null {
  const mine = [...state.tasks.values()]
    .map((t) => ({ t, part: partIn(t, me) }))
    .filter((x): x is { t: Task; part: Part } => x.part !== null)
    .sort((a, b) => (a.part === b.part ? a.t.id - b.t.id : a.part === "owner" ? -1 : 1));
  const board = state.lead === me ? boardBlock(state, me, mc) : null;
  const lead = leadCheckpoint(state, me);
  const blocks: Block[] = [
    ...mine.map(({ t, part }) => taskBlock(t, part, now, mc)),
    ...(lead ? [leadBlock(lead, now, mc)] : []),
    ...(board ? [board] : []),
    ...(state.compact
      ? [{ text: `The channel's history is compacted through #${state.compact.through}: ${inlineText(state.compact.summary, 400)}`, elsewhere: `the compacted history (${mc} compact)` }]
      : []),
  ];
  if (!blocks.length) return null;
  const header = mine.length || lead ? HEADER : null;
  const shown: Block[] = [];
  let used = 0;
  for (const block of blocks) {
    const cost = (used ? 1 : (header?.length ?? -1) + 1) + block.text.length;
    if (used + cost <= max) {
      shown.push(block);
      used += cost;
    }
  }
  const leftOf = () => blocks.filter((b) => !shown.includes(b));
  let text = assemble(header, shown, leftOf(), mc);
  while (text.length > max && shown.length) {
    shown.pop();
    text = assemble(header, shown, leftOf(), mc);
  }
  if (text.length <= max) return text;
  const pointers = [...(lead ? [`${pointer(mc)}; your lead checkpoint: ${leadNote(lead, mc)}`] : []), pointer(mc)];
  return pointers.find((p) => p.length <= max) ?? null;
}

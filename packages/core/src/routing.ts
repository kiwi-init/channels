import { MAX_AREAS, type TaskState } from "./protocol.ts";
import { inlineText } from "./membership.ts";
import { isPerson, taskId, type ChannelState, type Task } from "./state.ts";

export interface Candidate {
  name: string;
  score: number;
  queue: number;
  reasons: string[];
  warm: boolean;
}

const BUSY_QUEUE = 3;
const WARM = 4;

const OPEN_STATES = new Set<TaskState>(["todo", "doing", "review"]);

function kin(state: ChannelState, t: Task): { task: Task; how: string; weight: number }[] {
  const out: { task: Task; how: string; weight: number }[] = [];
  const parent = t.from === undefined ? undefined : state.tasks.get(t.from);
  if (parent) out.push({ task: parent, how: "where it came from", weight: 3 });
  for (const x of state.tasks.values()) {
    if (x.id === t.id) continue;
    if (x.from === t.id) out.push({ task: x, how: "a follow-up of it", weight: 3 });
    else if (parent && x.from === parent.id) out.push({ task: x, how: `also from ${taskId(parent.id)}`, weight: 2 });
  }
  const grand = parent?.from === undefined ? undefined : state.tasks.get(parent.from);
  if (grand && grand.id !== t.id) out.push({ task: grand, how: `where ${taskId(parent!.id)} came from`, weight: 1 });
  return out;
}

const touched = (t: Task, name: string) => t.owner === name || t.workedBy.includes(name) || t.touched?.[name] !== undefined;

const AREA_DEPTH = 3;
const RECENT_WORK = 10;
const PATH_IN_TEXT = /(?:^|[\s`(])((?:[\w.@+-]+\/)+[\w.@+-]+)/g;

export function areasOf(files: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const f of files) {
    const dirs = f.split("/").slice(0, -1);
    if (!dirs.length || dirs.some((d) => d === "." || d === ".." || !d)) continue;
    const area = dirs.slice(0, AREA_DEPTH).join("/");
    count.set(area, (count.get(area) ?? 0) + 1);
  }
  return [...count]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_AREAS)
    .map(([a]) => a);
}

export function taskAreas(state: ChannelState, t: Task): string[] {
  if (t.areas?.length) return t.areas;
  const parent = t.from === undefined ? undefined : state.tasks.get(t.from);
  if (parent?.areas?.length) return parent.areas;
  const named = [...`${t.title}\n${t.detail ?? ""}`.matchAll(PATH_IN_TEXT)].map((m) => m[1]!.replace(/[.,:;)]+$/, ""));
  return areasOf(named.map((p) => (/\.[\w]+$/.test(p) ? p : `${p}/x`)));
}

const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function sharedAreas(want: readonly string[], have: readonly string[]): string[] {
  return want.filter((w) => have.some((h) => overlaps(w, h)));
}

export function taskCandidates(state: ChannelState, id: number): Candidate[] {
  const t = state.tasks.get(id);
  if (!t) return [];
  const family = kin(state, t);
  const want = taskAreas(state, t);
  return [...state.members.values()]
    .filter((m) => m.active && !isPerson(m))
    .map((m) => {
      const hits: { task: Task; text: string; weight: number }[] = [];
      if (touched(t, m.name)) hits.push({ task: t, text: `worked ${taskId(t.id)} before`, weight: 4 });
      for (const k of family) if (touched(k.task, m.name)) hits.push({ task: k.task, text: `worked ${taskId(k.task.id)}, ${k.how}`, weight: k.weight });
      const best = want.length
        ? [...state.tasks.values()]
            .filter((x) => x.id !== t.id && x.areas?.length && touched(x, m.name))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, RECENT_WORK)
            .map((x) => ({ x, shared: sharedAreas(want, x.areas!) }))
            .sort((a, b) => b.shared.length - a.shared.length)[0]
        : undefined;
      if (best?.shared.length) hits.push({ task: best.x, text: `touched ${best.shared.slice(0, 2).join(", ")} in ${taskId(best.x.id)}`, weight: 2 });
      const fresh = m.card?.fresh;
      const isWarm = (x: Task) => fresh !== undefined && (x.touched?.[m.name] ?? 0) >= fresh;
      const warmHit = hits.some((h) => isWarm(h.task));
      const score = hits.reduce((n, h) => n + h.weight, 0) + (warmHit ? WARM : 0);
      const reasons = hits.map((h) => (isWarm(h.task) ? `${h.text} (this session)` : h.text));
      const queue = [...state.tasks.values()].filter((x) => x.id !== t.id && x.owner === m.name && OPEN_STATES.has(x.state)).length;
      return { name: m.name, score, queue, reasons, warm: warmHit };
    })
    .sort((a, b) => b.score - a.score || a.queue - b.queue || a.name.localeCompare(b.name));
}

export function pickFor(candidates: readonly Candidate[]): Candidate | null {
  return candidates.find((c) => c.score > 0 && c.queue < BUSY_QUEUE) ?? null;
}

export function formatCandidates(t: Task, candidates: readonly Candidate[]): string {
  const out = [`who has ${taskId(t.id)}'s context (${inlineText(t.title, 120)}):`];
  if (!candidates.length) out.push("  no agents here");
  for (const c of candidates) {
    const ahead = c.queue === 1 ? "1 task ahead" : `${c.queue} tasks ahead`;
    const busy = c.score > 0 && c.queue >= BUSY_QUEUE ? " (busy: the lead decides)" : "";
    out.push(`  ${inlineText(c.name, 40)} · ${c.reasons.length ? c.reasons.join("; ") : "no context"} · ${ahead}${busy}`);
  }
  const top = pickFor(candidates);
  out.push(top ? `kiwi task assign ${taskId(t.id)} (no name) gives it to ${top.name}` : `nobody free has its context: name someone, kiwi task assign ${taskId(t.id)} NAME`);
  return out.join("\n");
}

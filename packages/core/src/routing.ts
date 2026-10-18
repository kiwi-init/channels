import { MAX_AREAS, type TaskState } from "./protocol.ts";
import { isPerson, taskId, type ChannelState, type Task } from "./state.ts";

export interface Candidate {
  name: string;
  score: number;
  queue: number;
  reasons: string[];
}

export const BUSY_QUEUE = 3;

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

const touched = (t: Task, name: string) => t.owner === name || t.workedBy.includes(name);

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
      const reasons: string[] = [];
      let score = 0;
      if (touched(t, m.name)) {
        score += 4;
        reasons.push(`worked ${taskId(t.id)} before`);
      }
      for (const k of family)
        if (touched(k.task, m.name)) {
          score += k.weight;
          reasons.push(`worked ${taskId(k.task.id)}, ${k.how}`);
        }
      const best = want.length
        ? [...state.tasks.values()]
            .filter((x) => x.id !== t.id && x.areas?.length && touched(x, m.name))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, RECENT_WORK)
            .map((x) => ({ x, shared: sharedAreas(want, x.areas!) }))
            .sort((a, b) => b.shared.length - a.shared.length)[0]
        : undefined;
      if (best?.shared.length) {
        score += 2;
        reasons.push(`touched ${best.shared.slice(0, 2).join(", ")} in ${taskId(best.x.id)}`);
      }
      const queue = [...state.tasks.values()].filter((x) => x.id !== t.id && x.owner === m.name && OPEN_STATES.has(x.state)).length;
      return { name: m.name, score, queue, reasons };
    })
    .sort((a, b) => b.score - a.score || a.queue - b.queue || a.name.localeCompare(b.name));
}

export function pickFor(candidates: readonly Candidate[]): Candidate | null {
  return candidates.find((c) => c.score > 0 && c.queue < BUSY_QUEUE) ?? null;
}

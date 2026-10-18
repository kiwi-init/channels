import type { TaskState } from "./protocol.ts";
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

export function taskCandidates(state: ChannelState, id: number): Candidate[] {
  const t = state.tasks.get(id);
  if (!t) return [];
  const family = kin(state, t);
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
      const queue = [...state.tasks.values()].filter((x) => x.id !== t.id && x.owner === m.name && OPEN_STATES.has(x.state)).length;
      return { name: m.name, score, queue, reasons };
    })
    .sort((a, b) => b.score - a.score || a.queue - b.queue || a.name.localeCompare(b.name));
}

export function pickFor(candidates: readonly Candidate[]): Candidate | null {
  return candidates.find((c) => c.score > 0 && c.queue < BUSY_QUEUE) ?? null;
}

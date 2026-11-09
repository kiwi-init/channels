import { inlineText } from "./membership.ts";
import { BUSY_QUEUE, pickFor, type Candidate, type Reason, type Why } from "./routing.ts";
import { taskId, type Task } from "./state.ts";

function whyText(w: Why): string {
  switch (w.kind) {
    case "worked":
      return `worked ${taskId(w.task)} before`;
    case "from":
      return `worked ${taskId(w.task)}, where it came from`;
    case "follow-up":
      return `worked ${taskId(w.task)}, a follow-up of it`;
    case "sibling":
      return `worked ${taskId(w.task)}, also from ${taskId(w.parent)}`;
    case "grand":
      return `worked ${taskId(w.task)}, where ${taskId(w.parent)} came from`;
    case "areas":
      return `touched ${w.areas.join(", ")} in ${taskId(w.task)}`;
  }
}

export const reasonText = (r: Reason): string => (r.warm ? `${whyText(r)} (this session)` : whyText(r));

export function formatCandidates(t: Task, candidates: readonly Candidate[]): string {
  const out = [`who has ${taskId(t.id)}'s context (${inlineText(t.title, 120)}):`];
  if (!candidates.length) out.push("  no agents here");
  for (const c of candidates) {
    const ahead = c.queue === 1 ? "1 task ahead" : `${c.queue} tasks ahead`;
    const busy = c.score > 0 && c.queue >= BUSY_QUEUE ? " (busy: the lead decides)" : "";
    out.push(`  ${inlineText(c.name, 40)} · ${c.whys.length ? c.whys.map(reasonText).join("; ") : "no context"} · ${ahead}${busy}`);
  }
  const top = pickFor(candidates);
  out.push(top ? `kiwi task assign ${taskId(t.id)} (no name) gives it to ${top.name}` : `nobody free has its context: name someone, kiwi task assign ${taskId(t.id)} NAME`);
  return out.join("\n");
}

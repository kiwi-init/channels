import { inlineText } from "./membership.ts";
import { changedSinceApproval, doneWhen, freeAgents, specPlanner, specQueue, specStage, specTasks, specTitle, type SpecStage } from "./state/specs.ts";
import { taskId } from "./state/tasks.ts";
import type { ChannelState, Spec } from "./state/types.ts";

const ordinal = (n: number): string => (n === 1 ? "next" : `${n}${n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"} in line`);

function specStageText(state: ChannelState, spec: Spec): string {
  const stage: SpecStage = specStage(state, spec);
  const asker = state.askHeads.get(spec.ask)?.by;
  switch (stage) {
    case "draft":
      return `draft: ${asker ? `${asker} or another person` : "a person"} approves it, then it starts by itself`;
    case "queued": {
      if (changedSinceApproval(spec)) return "approved, then changed: it waits for a person to approve the changes";
      const planner = specPlanner(state, spec.ask);
      if (planner) return `approved: ${planner} is planning it`;
      const place = specQueue(state).findIndex((s) => s.ask === spec.ask) + 1;
      const free = freeAgents(state).length;
      return `approved: starts when an agent is free (${ordinal(place)}; ${free === 1 ? "1 agent is" : `${free} agents are`} free)`;
    }
    case "working": {
      const open = specTasks(state, spec.ask).filter((t) => t.state !== "done" && !t.archived && !t.cancelled);
      return `working: ${open.map((t) => `${taskId(t.id)} ${t.state}${t.owner ? ` (${t.owner})` : ""}`).join(", ")}`;
    }
    case "delivered":
      return `delivered: waiting on ${asker ?? "a person"}'s verdict`;
    case "accepted":
      return `accepted by ${spec.result?.by ?? "a person"}`;
    case "dropped":
      return `dropped by ${spec.result?.by ?? "a person"}${spec.result?.note ? `: ${inlineText(spec.result.note, 120)}` : ""}`;
  }
}

function doneLine(spec: Spec): string {
  const boxes = doneWhen(spec.text);
  return boxes.length ? ` · ${boxes.filter((b) => b.done).length}/${boxes.length} done when` : "";
}

export function specLine(state: ChannelState, spec: Spec): string {
  return `#${spec.ask} ${inlineText(specTitle(spec, state.askHeads.get(spec.ask)), 80)} · ${specStageText(state, spec)}${doneLine(spec)}`;
}

export function formatSpecs(state: ChannelState, all = false): string {
  const list = [...state.specs.values()].filter((s) => all || !s.result).sort((a, b) => a.ask - b.ask);
  if (!list.length) return all ? "no specs yet" : "no open specs (kiwi specs --all shows accepted and dropped ones)";
  return list.map((s) => specLine(state, s)).join("\n");
}

export function formatSpec(state: ChannelState, spec: Spec): string {
  const head = state.askHeads.get(spec.ask);
  const tasks = specTasks(state, spec.ask);
  const lines = [
    `#${spec.ask} · ${specStageText(state, spec)}`,
    head ? `asked by ${head.by}: “${inlineText(head.words, 200)}”` : null,
    `version ${spec.v} by ${spec.by}${spec.edits > 1 ? ` (${spec.edits} edits by ${spec.editors.join(", ")})` : ""}`,
    spec.approved
      ? `approved by ${spec.approved.by} at version ${spec.approved.v}${changedSinceApproval(spec) ? ", changed since: a person approves the changes before new work starts on them" : ""}`
      : null,
    ...spec.backs.map((b) => `sent back by ${b.by}: ${inlineText(b.note, 300)}`),
    tasks.length ? `tasks: ${tasks.map((t) => `${taskId(t.id)} ${t.state}${t.owner ? ` (${t.owner})` : ""}`).join(", ")}` : null,
    "",
    spec.text,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function planningText(state: ChannelState, spec: Spec, mc = "kiwi"): string {
  const back = spec.backs.at(-1);
  const done = specTasks(state, spec.ask).filter((t) => t.state === "done").length;
  const why = back
    ? `${back.by} sent it back: “${inlineText(back.note, 400)}”. Read the note, then file the tasks that answer it.`
    : done
      ? "Its tasks are done but some boxes under Done when aren't ticked: prove each one (tick it with its proof), or file the task that does."
      : "Nobody has started it yet.";
  return [
    `Spec #${spec.ask} “${inlineText(specTitle(spec, state.askHeads.get(spec.ask)), 120)}” is approved and you're free, so it's yours to start. ${why}`,
    `Read it with \`${mc} spec show ${spec.ask}\`. Split what's left into tasks filed under it (\`${mc} task add "…" --ask ${spec.ask}\`), each small enough for one session, take the first with \`${mc} task start T…\`, and leave the rest open: free agents take them by themselves.`,
    `Work to the approved spec. When a box under Done when is proven, tick it with \`${mc} spec tick ${spec.ask} "words of its line"\`. Anything outside the spec is a change to it: edit it with \`${mc} spec write ${spec.ask} --file spec.md\` and a person approves the change, or comment with \`${mc} spec comment ${spec.ask} "…" --on "the line"\`.`,
  ].join("\n\n");
}

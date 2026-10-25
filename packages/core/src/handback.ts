import { inlineText } from "./membership.ts";
import { stageOf } from "./stage.ts";
import { taskId, type ChannelState, type Task } from "./state.ts";

export const heldBy = (state: Pick<ChannelState, "tasks">, name: string): Task[] => [...state.tasks.values()].filter((t) => t.owner === name && t.state !== "done");

function whereItStands(state: ChannelState, t: Task): string {
  const pr = stageOf(state, t).pr;
  const work = pr ? `PR #${pr.number}${pr.branch ? ` on ${pr.branch}` : ""}${pr.sha ? `, head ${pr.sha.slice(0, 7)}` : ""}, ${pr.state}` : "no PR yet";
  const checkpoint = [...t.notes].reverse().find((n) => n.checkpoint);
  return `${work}; ${checkpoint ? `its checkpoint (#${checkpoint.seq}) says where it stands` : "no checkpoint written"}`;
}

export function handBackText(state: ChannelState, who: string, how: "left" | "removed", tasks: readonly Task[]): string {
  const head = how === "left" ? `${who} is leaving the channel.` : `${who} was removed from the channel.`;
  return [`${head} Back on the board, open for someone to take:`, ...tasks.map((t) => `- ${taskId(t.id)} ${inlineText(t.title, 80)}: ${whereItStands(state, t)}`)].join("\n");
}

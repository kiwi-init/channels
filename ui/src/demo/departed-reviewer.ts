import type { Channel } from "../model.ts"

export function withDepartedReviewer(c: Channel, readOnly = false): Channel {
  return {
    ...c,
    you: readOnly ? "maya" : c.you,
    youOwn: readOnly ? false : c.youOwn,
    people: c.people.map((p) => (readOnly ? { ...p, you: p.name === "maya", ...(p.name === "maya" ? { readOnly: true } : {}) } : p)),
    former: c.former?.map((p) => (p.name === "scout" ? { ...p, display: "Sage" } : p)),
    nicknames: new Map([...c.nicknames, ["scout", "Sage"]]),
    tasks: c.tasks.map((task) =>
      task.id === 14
        ? { ...task, reviewer: "scout", youReview: undefined }
        : task.id === 12
          ? { ...task, reviewer: "ridge", youReview: undefined }
          : task.id === 16
            ? { ...task, reviewer: "scout", rounds: task.rounds.map((r) => ({ ...r, judge: "scout" })), history: task.history.map((e) => (e.what === "approved" ? { ...e, by: "scout" } : e)) }
            : task
    ),
  }
}

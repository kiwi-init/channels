import type { Channel, Person } from "~/model"
import { memberOf } from "~/model"
import type { ModGithub, ModPerson, ModTask } from "~/mods/protocol"
import { nickname } from "~/names"
import { wordsPlain } from "~/words"

type Source = Pick<Channel, "repos" | "prs" | "issues" | "tasks" | "github" | "people" | "former" | "nicknames">

const face = ({ name, kind, harness, presence, color, picture, face, activity, load, red, doneAt }: Person): ModPerson => ({
  name,
  kind,
  harness,
  presence,
  color,
  picture,
  face,
  activity,
  load,
  red,
  doneAt,
})

export function githubData(c: Source): ModGithub {
  const linked = new Set<number>()
  for (const x of [...(c.prs ?? []), ...(c.issues ?? [])]) if (x.task !== undefined) linked.add(x.task)
  const tasks: ModTask[] = c.tasks
    .filter((t) => linked.has(t.id))
    .map((t) => {
      const owner = t.owner ? memberOf(c, t.owner) : undefined
      return {
        id: t.id,
        title: wordsPlain(t.title, c.nicknames),
        status: t.cancelled ? "todo" : t.status,
        owner: t.owner ? { nickname: nickname(c, t.owner), person: owner ? face(owner) : null } : null,
      }
    })
  return { repos: [...c.repos], prs: c.prs ?? [], issues: c.issues ?? [], tasks, health: c.github ?? null }
}

import { describe, expect, test } from "bun:test"

import type { Channel, Issue, Person, PullRequest, Task } from "~/model"
import { githubData } from "~/mods/github-data"
import { wrote } from "~/words"

const person = (name: string, kind: Person["kind"] = "agent"): Person => ({ name, kind, presence: "online" }) as Person
const task = (id: number, owner?: string, extra: Partial<Task> = {}): Task => ({ id, title: wrote(`Task ${id}`), status: "doing", ...(owner ? { owner } : {}), ...extra }) as Task
const pr = (number: number, t?: number): PullRequest =>
  ({ repo: "kiwi-init/channels", number, title: `PR ${number}`, state: "open", url: `https://github.com/kiwi-init/channels/pull/${number}`, ...(t ? { task: t } : {}) }) as PullRequest
const issue = (number: number, t?: number): Issue => ({ repo: "kiwi-init/channels", number, title: `Issue ${number}`, state: "open", url: "", at: 0, ...(t ? { task: t } : {}) }) as Issue

const channel = (over: Partial<Channel> = {}) =>
  ({
    repos: ["kiwi-init/channels"],
    prs: [pr(1, 10), pr(2)],
    issues: [issue(3, 11)],
    tasks: [task(10, "quick-tortoise"), task(11, undefined, { cancelled: true }), task(12, "maya")],
    people: [person("quick-tortoise"), person("maya", "human")],
    former: [],
    nicknames: new Map([["quick-tortoise", "Quick Tortoise"]]),
    ...over,
  }) as Channel

describe("the GitHub snapshot a mod sees (T6270)", () => {
  test("it carries the repos, pull requests and issues, and only the tasks they link", () => {
    const data = githubData(channel())
    expect(data.repos).toEqual(["kiwi-init/channels"])
    expect(data.prs.map((p) => p.number)).toEqual([1, 2])
    expect(data.issues.map((i) => i.number)).toEqual([3])
    expect(data.tasks.map((t) => t.id)).toEqual([10, 11])
    expect(data.health).toBeNull()
  })

  test("a linked task brings its plain title, its status and its owner's face and nickname", () => {
    const [mine, cancelled] = githubData(channel()).tasks
    expect(mine).toEqual({ id: 10, title: "Task 10", status: "doing", owner: { nickname: "Quick Tortoise", person: expect.objectContaining({ name: "quick-tortoise", kind: "agent" }) } })
    expect(cancelled?.status).toBe("todo")
    expect(cancelled?.owner).toBeNull()
  })

  test("an owner who left still has a face, and one nobody knows keeps a nickname", () => {
    const gone = githubData(channel({ people: [], former: [person("quick-tortoise")] })).tasks[0]
    expect(gone?.owner?.person?.name).toBe("quick-tortoise")
    expect(githubData(channel({ people: [], former: [] })).tasks[0]?.owner).toEqual({ nickname: "Quick Tortoise", person: null })
  })

  test("a channel with no GitHub gives an empty snapshot, not a missing one", () => {
    expect(githubData(channel({ repos: [], prs: undefined, issues: undefined, tasks: [] }))).toEqual({ repos: [], prs: [], issues: [], tasks: [], health: null })
  })
})

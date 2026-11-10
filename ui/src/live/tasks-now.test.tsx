import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { useTasksNow } from "~/live/tasks-now"
import type { Channel, Task } from "~/model"
import { moverWords, quietTasks } from "~/tasks/mover"

const HEAD = "1".repeat(40)
const MIN = 60_000
const TICK = 5
const TASK = 2
const HELD: ReadonlySet<number> = new Set()

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "owl", pk: "pk-owl", owner: false, at: 0, active: true, kind: "agent", role: "lead", runs: { harness: "claude" } },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const event = (seq: number, from: string, ev: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: seq * 1000, rts: seq * 1000 }) as Wire

const container = () => ({
  nodeType: 1,
  tagName: "DIV",
  nodeName: "DIV",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener() {},
  removeEventListener() {},
  ownerDocument: { addEventListener() {}, removeEventListener() {}, defaultView: { HTMLIFrameElement: class {}, document: { activeElement: null } } },
})

const saved = { window: Reflect.get(globalThis, "window"), act: Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT") }

beforeAll(() => {
  Reflect.set(globalThis, "window", globalThis)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
})

afterAll(() => {
  setSystemTime()
  Reflect.set(globalThis, "window", saved.window)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", saved.act)
})

const channel = (tasks: Task[]): Channel => ({ you: "jow", youOwn: true, lead: "owl", tasks, nicknames: new Map() }) as unknown as Channel

async function mounted(wires: Wire[], me: string, start: number) {
  setSystemTime(new Date(start))
  const state = fold(wires, roster, start)
  let shown: Task[] = []
  let renders = 0
  const Probe = () => {
    shown = useTasksNow(state, HELD, me, wires, TICK)
    renders++
    return null
  }
  const root = createRoot(container() as unknown as HTMLElement)
  await act(async () => root.render(<Probe />))
  const task = (): Task => {
    const found = shown.find((t) => t.id === TASK)
    if (!found) throw new Error("no task")
    return found
  }
  return {
    task,
    quiet: (now: number) => quietTasks(channel(shown), now).map((t) => t.id),
    words: (now: number) => moverWords(channel(shown), task(), now),
    renders: () => renders,
    at: async (now: number) => {
      setSystemTime(new Date(now))
      await act(async () => {
        await new Promise((done) => setTimeout(done, 8 * TICK))
      })
    },
    close: () => act(async () => root.unmount()),
  }
}

const approved = (steps?: Extract<Event, { op: "task.add" }>["steps"]): Wire[] => [
  event(1, "jow", { op: "landing.set", then: "merge" }),
  event(TASK, "jow", { op: "task.add", title: "deploy", owner: "win", review: "mac", ...(steps ? { steps } : {}) }),
  event(3, "win", { op: "task.update", task: TASK, state: "review", at: HEAD }),
  event(4, "mac", { op: "task.update", task: TASK, state: "done", verdict: "approved", round: 1, at: HEAD }),
]

const run = (seq: number, id: number, title: string, more: Record<string, unknown>): Wire =>
  event(seq, "jow", { op: "github", items: [{ event: "workflow_run", repo: "o/r", at: seq * 1000, run: id, title, started: seq * 1000, ...more }] } as Event)

describe("the tasks on screen follow the clock with no new message (#3930 §1 to §3)", () => {
  test("a wait ends and then N passes: the task gets its mover back and enters the quiet list", async () => {
    const wires = [...approved(), event(5, "jow", { op: "task.steps", task: TASK, edit: { kind: "wait", id: "s1", reason: "soak", ms: 60 * MIN } })]
    const view = await mounted(wires, "jow", 5000 + 10 * MIN)
    expect(view.task().mover?.kind).toBe("hold")
    expect(view.task().quiet).toBeUndefined()
    expect(view.quiet(5000 + 10 * MIN)).toEqual([])
    const later = 5000 + 90 * MIN
    await view.at(later)
    expect(view.task().mover).toEqual({ kind: "member", name: "win", move: "land" })
    expect(view.words(later)).toBe("win to land it")
    expect(view.task().quiet).toMatchObject({ with: "win", since: 5000 + 60 * MIN })
    expect(view.quiet(later)).toEqual([TASK])
    await view.close()
  })

  test("a person's wait ends: the step becomes theirs to mark done", async () => {
    const wires = [
      ...approved(),
      event(5, "jow", { op: "task.steps", task: TASK, edit: { kind: "by", id: "s1", by: "jow" } }),
      event(6, "jow", { op: "task.steps", task: TASK, edit: { kind: "wait", id: "s1", reason: "soak", ms: MIN } }),
    ]
    const view = await mounted(wires, "jow", 10_000)
    expect(view.task().steps?.[0]).toMatchObject({ state: "current", wait: { until: 6000 + MIN } })
    expect(view.task().steps?.[0]?.yours).toBeUndefined()
    await view.at(6000 + 2 * MIN)
    expect(view.task().steps?.[0]?.yours).toBe(true)
    expect(view.task().steps?.[0]?.wait).toBeUndefined()
    await view.close()
  })

  test("a step with a wait and a run: the wait ends and the run has the move; the run overruns and its member has it", async () => {
    const wires = [
      run(1, 1, "warm-up", { action: "completed", conclusion: "success" }),
      ...approved([{ words: "deploy", by: "win", wait: { reason: "soak", ms: 10 * MIN }, run: { id: "deploy-7", expected: 60 * MIN } }]).slice(1, 2),
      run(3, 70, "deploy-7", { action: "in_progress" }),
      event(4, "win", { op: "task.update", task: TASK, state: "review", at: HEAD }),
      event(5, "mac", { op: "task.update", task: TASK, state: "done", verdict: "approved", round: 1, at: HEAD }),
    ]
    const view = await mounted(wires, "jow", 10_000)
    expect(view.task().mover?.kind).toBe("hold")
    expect(view.task().steps?.[0]?.wait?.until).toBe(5000 + 10 * MIN)
    const running = 5000 + 15 * MIN
    await view.at(running)
    expect(view.task().mover).toEqual({ kind: "run", behind: "win", due: 5000 + 60 * MIN })
    expect(view.words(running)).toBe("A run has the move for 45m, then win")
    expect(view.task().steps?.[0]).toMatchObject({ run: { due: 5000 + 60 * MIN } })
    expect(view.task().steps?.[0]?.wait).toBeUndefined()
    const overrun = 5000 + 61 * MIN
    await view.at(overrun)
    expect(view.task().mover).toEqual({ kind: "member", name: "win", move: "land", trouble: "overran" })
    expect(view.words(overrun)).toBe("win to land it (its run overran)")
    expect(view.task().steps?.[0]).toMatchObject({ trouble: "overran" })
    expect(view.task().steps?.[0]?.run).toBeUndefined()
    await view.close()
  })

  test("a run that failed, and one that can't be seen, are their member's step at once, never shown as running", async () => {
    const steps = [{ words: "deploy", by: "win", run: { id: "deploy-7", expected: 60 * MIN } }]
    const failed = [run(1, 1, "warm-up", { action: "completed", conclusion: "success" }), ...approved(steps).slice(1), run(5, 70, "deploy-7", { action: "completed", conclusion: "failure" })]
    const broke = await mounted(failed, "jow", 5000 + MIN)
    expect(broke.task().mover).toEqual({ kind: "member", name: "win", move: "land", trouble: "failed" })
    expect(broke.task().steps?.[0]).toMatchObject({ state: "current", trouble: "failed" })
    expect(broke.task().steps?.[0]?.run).toBeUndefined()
    await broke.close()
    const blind = await mounted(approved([{ words: "deploy", by: "win", run: { expected: 60 * MIN } }]), "jow", 5000 + MIN)
    expect(blind.task().mover).toEqual({ kind: "member", name: "win", move: "land", trouble: "unseen" })
    expect(blind.task().steps?.[0]).toMatchObject({ state: "current", trouble: "unseen" })
    expect(blind.task().steps?.[0]?.run).toBeUndefined()
    await blind.close()
  })

  test("with nothing due, the tick keeps the same answer", async () => {
    const view = await mounted(approved(), "win", 10_000)
    const first = view.task()
    await view.at(10_000 + MIN)
    expect(view.task()).toEqual(first)
    expect(view.renders()).toBeGreaterThan(1)
    await view.close()
  })
})

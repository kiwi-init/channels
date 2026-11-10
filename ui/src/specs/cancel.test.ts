import { describe, expect, test } from "bun:test"

import type { Task } from "~/model"
import { cancelConfirm } from "~/specs/cancel"
import { wrote } from "~/words"

const task = (id: number, status: Task["status"]): Task => ({
  id,
  title: wrote(`task ${id}`),
  status,
  createdBy: "atlas",
  createdAt: 0,
  updatedAt: 0,
  notes: [],
  rounds: [],
  history: [],
  archived: false,
})
const nicknames = new Map([["gentle-otter", "lead"]])

describe("cancelling a spec asks the same thing from its menu and its Result tab (T1860)", () => {
  test("the question names the spec by its title, with people's nicknames, and offers Keep it or Cancel spec", () => {
    const asked = cancelConfirm({ tasks: [], nicknames }, { title: wrote("Pair with @gentle-otter on the relay"), tasks: [] })
    expect(asked).toEqual({ title: 'Cancel "Pair with @lead on the relay"?', sub: "It moves under Dropped, and no new work goes under it.", yes: "Cancel spec", no: "Keep it" })
  })

  test("it says how many open tasks go with it, and doesn't count done ones", () => {
    const tasks = [task(1, "doing"), task(2, "done"), task(3, "review")]
    expect(cancelConfirm({ tasks, nicknames }, { title: wrote("x"), tasks: [1, 2, 3] }).sub).toBe("It moves under Dropped, and no new work goes under it. Its 2 open tasks are cancelled with it.")
    expect(cancelConfirm({ tasks, nicknames }, { title: wrote("x"), tasks: [1, 2] }).sub).toBe("It moves under Dropped, and no new work goes under it. Its open task is cancelled with it.")
  })
})

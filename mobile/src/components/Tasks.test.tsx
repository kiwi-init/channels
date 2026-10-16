import { fireEvent, render, screen } from "@testing-library/react-native"
import type { TaskState } from "@mc/protocol.ts"
import type { Task } from "@mc/state.ts"

import { TaskDetails } from "./TaskDetails"
import { TaskList } from "./TaskList"

const NOW = Date.UTC(2026, 9, 16, 15, 0, 0)

const task = (id: number, state: TaskState, over: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id} is ${state}`,
  state,
  createdBy: "jow",
  createdAt: NOW - 3_600_000,
  updatedAt: NOW - id * 60_000,
  notes: [],
  workedBy: [],
  rounds: [],
  ...over,
})

const STATES: TaskState[] = ["todo", "doing", "review", "done"]
const nameOf = (name: string) => name

describe("TaskList", () => {
  it("renders a task in every state, in progress first and done last, and opens one", async () => {
    const onOpen = jest.fn()
    const tasks = [task(1, "done"), task(2, "todo"), task(3, "review", { owner: "bus" }), task(4, "doing", { owner: "bus", notes: [{ seq: 9, by: "bus", ts: NOW, text: "x" }] })]
    await render(<TaskList tasks={tasks} nameOf={nameOf} now={NOW} onOpen={onOpen} />)
    const labels = screen.getAllByLabelText(/^Open task/).map((node) => node.props.accessibilityLabel as string)
    expect(labels.map((l) => l.split(": ")[1])).toEqual(["Task 4 is doing", "Task 3 is review", "Task 2 is todo", "Task 1 is done"])
    for (const state of ["In progress", "In review", "Open", "Done"]) expect(screen.getAllByLabelText(state).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 note/)).toBeTruthy()
    expect(screen.getAllByText("Unassigned")).toHaveLength(2)
    await fireEvent.press(screen.getByLabelText(/Open task .*Task 4 is doing/))
    expect(onOpen).toHaveBeenCalledWith(4)
  })

  it("says a cancelled task was cancelled, and an empty list is empty", async () => {
    await render(<TaskList tasks={[task(5, "done", { cancelled: true })]} nameOf={nameOf} now={NOW} onOpen={() => {}} />)
    expect(screen.getByText(/Cancelled/)).toBeTruthy()
    await render(<TaskList tasks={[]} nameOf={nameOf} now={NOW} onOpen={() => {}} />)
    expect(screen.getByText("No tasks yet.")).toBeTruthy()
  })
})

describe("TaskDetails", () => {
  it.each(STATES)("shows a %s task with its status", async (state) => {
    await render(<TaskDetails task={task(7, state)} nameOf={nameOf} now={NOW} noteBlocked={null} onNote={async () => {}} />)
    expect(screen.getByText(`Task 7 is ${state}`)).toBeTruthy()
    expect(screen.getByText({ todo: "Open", doing: "In progress", review: "In review", done: "Done" }[state])).toBeTruthy()
  })

  it("shows the review, its rounds in each result, notes, and an unassigned owner", async () => {
    const review = task(8, "review", {
      review: "*",
      rounds: [
        { n: 1, by: "bus", seq: 20, ts: NOW, result: { kind: "rejected", by: "jow", seq: 21, ts: NOW } },
        { n: 2, by: "bus", seq: 22, ts: NOW, result: { kind: "approved", by: "kiwi-sh", seq: 23, ts: NOW } },
        { n: 3, by: "bus", seq: 24, ts: NOW, result: { kind: "withdrawn", seq: 25 } },
        { n: 4, by: "bus", seq: 26, ts: NOW, result: { kind: "open" } },
      ],
      notes: [{ seq: 30, by: "bus", ts: NOW - 60_000, text: "tests pass" }],
    })
    await render(<TaskDetails task={review} nameOf={nameOf} now={NOW} noteBlocked={null} onNote={async () => {}} />)
    expect(screen.getByText("Anyone who hasn’t worked on it, waiting")).toBeTruthy()
    expect(screen.getByText("Round 1, asked by bus: rejected by jow")).toBeTruthy()
    expect(screen.getByText("Round 2, asked by bus: approved by kiwi-sh")).toBeTruthy()
    expect(screen.getByText("Round 3, asked by bus: withdrawn")).toBeTruthy()
    expect(screen.getByText("Round 4, asked by bus: waiting")).toBeTruthy()
    expect(screen.getByText("tests pass")).toBeTruthy()
    expect(screen.getByText("Nobody yet")).toBeTruthy()
  })

  it("sends a trimmed comment, keeps Comment disabled while empty, and says when notes are blocked", async () => {
    const onNote = jest.fn().mockResolvedValue(undefined)
    await render(<TaskDetails task={task(9, "doing")} nameOf={nameOf} now={NOW} noteBlocked={null} onNote={onNote} />)
    await fireEvent.press(screen.getByLabelText("Comment"))
    expect(onNote).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByLabelText("Comment on T9"), "  looks good ")
    await fireEvent.press(screen.getByLabelText("Comment"))
    expect(onNote).toHaveBeenCalledWith("looks good")
    await render(<TaskDetails task={task(9, "doing")} nameOf={nameOf} now={NOW} noteBlocked="You can only read here" onNote={onNote} />)
    expect(screen.getByText("You can only read here")).toBeTruthy()
  })

  it("says so for a task that is gone", async () => {
    await render(<TaskDetails task={undefined} nameOf={nameOf} now={NOW} noteBlocked={null} onNote={async () => {}} />)
    expect(screen.getByText("This task is gone")).toBeTruthy()
  })
})

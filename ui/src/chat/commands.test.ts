import { describe, expect, test } from "bun:test"
import { matchCommands, parseCommand, type Command } from "~/chat/commands"

const ran: string[] = []
const commands: Command[] = [
  { name: "compact", summary: "Ask for a summary", run: (a) => void ran.push(`compact:${a}`) },
  { name: "pause", summary: "Pause the agents", args: "note", run: (a) => void ran.push(`pause:${a}`) },
  { name: "tasks", summary: "Open the tasks", run: () => void ran.push("tasks") },
]

describe("composer commands", () => {
  test("a lone slash lists every command, and a prefix narrows the list", () => {
    expect(matchCommands(commands, "/").map((c) => c.name)).toEqual(["compact", "pause", "tasks"])
    expect(matchCommands(commands, "/co").map((c) => c.name)).toEqual(["compact"])
    expect(matchCommands(commands, "/CO").map((c) => c.name)).toEqual(["compact"])
  })

  test("the list closes once a space or a path follows, or the text doesn't start with a slash", () => {
    expect(matchCommands(commands, "/pause now")).toEqual([])
    expect(matchCommands(commands, "/usr/bin")).toEqual([])
    expect(matchCommands(commands, "hello /compact")).toEqual([])
  })

  test("a whole name runs with the rest of the line as its arguments", () => {
    expect(parseCommand(commands, "/compact")?.command.name).toBe("compact")
    expect(parseCommand(commands, "/compact ")?.command.name).toBe("compact")
    expect(parseCommand(commands, "/pause  back at 3 ")).toMatchObject({ command: { name: "pause" }, args: "back at 3" })
  })

  test("an unknown name or a path is an ordinary message", () => {
    expect(parseCommand(commands, "/comp")).toBeNull()
    expect(parseCommand(commands, "/usr/bin/env")).toBeNull()
    expect(parseCommand(commands, "compact")).toBeNull()
  })
})

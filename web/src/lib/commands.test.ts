import { describe, expect, test } from "bun:test"

import { matchCommands, parseCommand, type Command } from "./commands"

const run = () => {}
const commands: Command[] = [
  { name: "tasks", summary: "Open the tasks", run },
  { name: "pause", summary: "Pause the agents", args: "note", run },
  { name: "resume", summary: "Resume the agents", run },
]

describe("matchCommands", () => {
  test("a lone slash lists every command", () => {
    expect(matchCommands(commands, "/").map((c) => c.name)).toEqual(["tasks", "pause", "resume"])
  })

  test("narrows by prefix as you type, ignoring case", () => {
    expect(matchCommands(commands, "/p").map((c) => c.name)).toEqual(["pause"])
    expect(matchCommands(commands, "/RE").map((c) => c.name)).toEqual(["resume"])
    expect(matchCommands(commands, "/x")).toEqual([])
  })

  test("is only for a message that starts with the slash and has no space yet", () => {
    expect(matchCommands(commands, "hello /p")).toEqual([])
    expect(matchCommands(commands, "/pause now")).toEqual([])
    expect(matchCommands(commands, "/usr/bin")).toEqual([])
    expect(matchCommands(commands, "")).toEqual([])
  })
})

describe("parseCommand", () => {
  test("finds the command and its arguments", () => {
    expect(parseCommand(commands, "/pause back at four")).toMatchObject({ command: { name: "pause" }, args: "back at four" })
    expect(parseCommand(commands, "/tasks")).toMatchObject({ command: { name: "tasks" }, args: "" })
    expect(parseCommand(commands, "/PAUSE  later ")).toMatchObject({ command: { name: "pause" }, args: "later" })
  })

  test("keeps a newline in the arguments", () => {
    expect(parseCommand(commands, "/pause one\ntwo")?.args).toBe("one\ntwo")
  })

  test("an unknown name, or a path, is an ordinary message", () => {
    expect(parseCommand(commands, "/nope")).toBeNull()
    expect(parseCommand(commands, "/usr/bin/env")).toBeNull()
    expect(parseCommand(commands, "pause")).toBeNull()
  })
})

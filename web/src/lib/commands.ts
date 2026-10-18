export interface Command {
  name: string
  summary: string
  args?: string
  run: (args: string) => void | Promise<void>
}

const NAME_ONLY = /^\/([^\s/]*)$/
const WITH_NAME = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/

export function matchCommands(commands: readonly Command[], text: string): Command[] {
  const typed = NAME_ONLY.exec(text)
  if (!typed) return []
  const prefix = typed[1]!.toLowerCase()
  return commands.filter((c) => c.name.startsWith(prefix))
}

export function parseCommand(commands: readonly Command[], text: string): { command: Command; args: string } | null {
  const found = WITH_NAME.exec(text)
  const command = found && commands.find((c) => c.name === found[1]!.toLowerCase())
  return command ? { command, args: (found[2] ?? "").trim() } : null
}

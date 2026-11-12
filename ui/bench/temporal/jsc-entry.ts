import { coldRun, steady } from "./engine.ts"

const g = globalThis as unknown as { __corpus: Parameters<typeof steady>[0]; arguments: string[]; print: (s: string) => void }
const [mode = "steady", impl = "date"] = g.arguments
Object.assign(globalThis, { console: { ...(globalThis.console ?? {}), error: (s: string) => g.print(`# ${s}`) } })
g.print(JSON.stringify(mode === "cold" ? coldRun(impl, g.__corpus) : steady(g.__corpus)))

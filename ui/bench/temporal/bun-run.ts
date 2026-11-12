import corpus from "./corpus.json"
import { coldRun, steady } from "./engine.ts"

const [mode = "steady", impl = "date"] = process.argv.slice(2)
const out = mode === "cold" ? coldRun(impl, corpus) : steady(corpus)
console.log(JSON.stringify(out))

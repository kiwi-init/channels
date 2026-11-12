import { coldRun, detect, steady } from "./engine.ts"

Object.assign(globalThis, { __bench: { detect, steady, coldRun } })

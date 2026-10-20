import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const runtimeWasm = /(^|\/)ort-wasm-[^/]*\.wasm$/

const noRuntimeWasm = (): Plugin => ({
  name: "kiwi-no-runtime-wasm",
  apply: "build",
  generateBundle(_, bundle) {
    for (const name of Object.keys(bundle)) if (runtimeWasm.test(name)) delete bundle[name]
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), noRuntimeWasm()],
  worker: { format: "es", plugins: () => [noRuntimeWasm()] },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "elkjs/lib/elk.bundled.js": resolve(import.meta.dirname, "./src/lib/no-elk.ts"),
    },
  },
  server: {
    // `bun run relay:dev` in the repo root serves the relay on :8787.
    proxy: { "/v1": { target: "http://localhost:8787", ws: true } },
  },
})

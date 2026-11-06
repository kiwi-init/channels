import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { build, defineConfig, type Plugin, type UserConfig } from "vite"

const shared: Pick<UserConfig, "resolve"> = {
  resolve: {
    alias: {
      "react-native": resolve(import.meta.dirname, "./src/chat/react-native.ts"),
      katex: resolve(import.meta.dirname, "./src/chat/react-native.ts"),
      "elkjs/lib/elk.bundled.js": resolve(import.meta.dirname, "./src/chat/no-elk.ts"),
      "~": resolve(import.meta.dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
}

const modFrame = (): Plugin => ({
  name: "kiwi-mod-frame",
  apply: "build",
  async closeBundle() {
    await build({
      configFile: false,
      root: import.meta.dirname,
      logLevel: "warn",
      plugins: [react()],
      define: { __DEV__: "false", "process.env.NODE_ENV": JSON.stringify("production") },
      resolve: {
        ...shared.resolve,
        alias: { "~/kit/outside": resolve(import.meta.dirname, "./src/mods/frame/outside.ts"), ...shared.resolve?.alias, mermaid: resolve(import.meta.dirname, "./src/mods/frame/no-mermaid.ts") },
      },
      build: {
        outDir: resolve(import.meta.dirname, "dist"),
        emptyOutDir: false,
        copyPublicDir: false,
        lib: { entry: resolve(import.meta.dirname, "src/mods/frame/runtime.tsx"), formats: ["iife"], name: "kiwiModFrame", fileName: () => "mod-frame.js", cssFileName: "mod-frame" },
      },
    })
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), modFrame()],
  define: { __DEV__: "false", ...(mode === "harness" ? { "import.meta.env.DEV": "true" } : {}) },
  ...shared,
  server: {
    port: 5175,
    proxy: { "/v1": { target: "http://localhost:8787", ws: true }, "/reactions": { target: "http://localhost:8787" } },
  },
}))

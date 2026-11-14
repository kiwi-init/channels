import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { slimIcon } from "./src/kit/slim-icons.ts"

function compactIcons(): Plugin {
  return {
    name: "compact-icons",
    transform(code, id) {
      if (!id.includes("/@hugeicons/core-free-icons/dist/esm/")) return null
      return { code: slimIcon(code), map: null }
    },
  }
}

const LINK_IN_HEAD = "document.head.appendChild(link)"

function lazyLinksAfterThePage(): Plugin {
  let moved = false
  return {
    name: "lazy-links-after-the-page",
    apply: "build",
    transform(code, id) {
      if (!id.includes("vite/preload-helper") || !code.includes(LINK_IN_HEAD)) return null
      moved = true
      return { code: code.replace(LINK_IN_HEAD, "document.body.appendChild(link)"), map: null }
    },
    buildEnd(error) {
      if (!error && !moved)
        this.error(`Vite's preload helper no longer has "${LINK_IN_HEAD}", so a lazy chunk's stylesheet would load in <head> again, where WebKit lays out no new element until it arrives`)
    },
  }
}

const firstLoad = new Set<string>()

function firstLoadChunks(): Plugin {
  return {
    name: "first-load-chunks",
    apply: "build",
    enforce: "pre",
    generateBundle(_, bundle) {
      firstLoad.clear()
      const add = (fileName: string): void => {
        const chunk = bundle[fileName]
        if (firstLoad.has(fileName) || chunk?.type !== "chunk") return
        firstLoad.add(fileName)
        for (const next of chunk.imports) add(next)
      }
      for (const chunk of Object.values(bundle)) if (chunk.type === "chunk" && chunk.isEntry) add(chunk.fileName)
      if (!firstLoad.size) this.error("first-load-chunks found no entry chunk, so lazy imports would list the first load as preload deps again")
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), compactIcons(), lazyLinksAfterThePage(), firstLoadChunks()],
  build: { modulePreload: { resolveDependencies: (_file, deps, { hostType }) => (hostType === "js" ? deps.filter((dep) => !firstLoad.has(dep)) : deps) } },
  define: { __DEV__: "false", ...(mode === "harness" ? { "import.meta.env.DEV": "true" } : {}) },
  resolve: {
    alias: {
      "react-native": resolve(import.meta.dirname, "./src/chat/react-native.ts"),
      katex: resolve(import.meta.dirname, "./src/chat/react-native.ts"),
      "elkjs/lib/elk.bundled.js": resolve(import.meta.dirname, "./src/chat/no-elk.ts"),
      "~": resolve(import.meta.dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5175,
    proxy: { "/v1": { target: "http://localhost:8787", ws: true }, "/reactions": { target: "http://localhost:8787" } },
  },
}))

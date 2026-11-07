import { resolve } from "node:path"
import { build, type Rollup } from "vite"

const inline = (code: string): string => code.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--")

async function iife(entry: string, name: string): Promise<string> {
  const out = await build({
    configFile: false,
    root: import.meta.dirname,
    logLevel: "warn",
    define: { __DEV__: "false", "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { alias: { "~": resolve(import.meta.dirname, "./src") } },
    build: {
      write: false,
      copyPublicDir: false,
      minify: true,
      lib: { entry: resolve(import.meta.dirname, entry), formats: ["iife"], name, fileName: () => `${name}.js` },
    },
  })
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[]
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === "chunk")
  if (!chunk) throw new Error(`${entry} built no script`)
  return chunk.code
}

export const afkFrameJs = (): Promise<string> => iife("src/afk/frame.ts", "kiwiAfkFrame")

export async function afkSceneHtml(): Promise<string> {
  const code = await iife("src/afk/scene.ts", "kiwiAfkScene")
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AFK scene</title>
    <style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}</style>
  </head>
  <body>
    <script>${inline(code)}</script>
  </body>
</html>
`
}

import { shrink, type ShrinkAsk, type ShrinkReply } from "~/chat/thumb-shrink"

let line: Promise<void> = Promise.resolve()

self.addEventListener("message", (e: MessageEvent<ShrinkAsk>) => {
  const { id, url, width, height, blob } = e.data
  line = line.then(async () => {
    let reply: ShrinkReply
    try {
      reply = { id, thumb: await shrink(url, width, height, blob) }
    } catch (err) {
      // This engine can't make the copy here (no canvas in workers, or a codec it lacks): the page tries on its own thread.
      reply = { id, failed: err instanceof Error ? err.message : String(err) }
    }
    self.postMessage(reply)
  })
})

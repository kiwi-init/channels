import type { KiwiBridge, UpdateView } from "@kiwi/secrets/secrets.ts"

export type Updater = Pick<KiwiBridge, "getUpdate" | "checkUpdate" | "installUpdate" | "onUpdate" | "openExternal">

export async function downloadAndRestart(b: Updater, say: (text: string) => void): Promise<void> {
  const u = await b.getUpdate()
  if (!u) return say("Channels is up to date")
  if (u.state === "ready") return b.installUpdate()
  if (u.blocked) return b.openExternal(u.url)
  const next = u.state === "downloading" ? u : await b.checkUpdate()
  if (next.state === "current") return say("Channels is up to date")
  if (next.state === "failed") throw new Error("GitHub didn't answer, try again in a minute")
  if (next.state === "ready") return b.installUpdate()
  if (next.state === "available") return b.openExternal(next.url)
  say(`Downloading Channels ${next.version}. It restarts when it's in`)
  let done = false
  let off = () => {}
  const settle = (s: UpdateView | null) => {
    if (done || !s || s.version !== next.version || s.state === "downloading") return
    done = true
    off()
    if (s.state === "ready") void b.installUpdate()
    else say(`Channels ${s.version} didn't download. Try again, or get it from the release page`)
  }
  off = b.onUpdate(settle)
  if (done) off()
  settle(await b.getUpdate())
}

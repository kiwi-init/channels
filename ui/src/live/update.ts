import "~/i18n/en/live-later"
import type { KiwiBridge, UpdateView } from "@kiwi/secrets/secrets.ts"
import { t } from "~/i18n/i18n"

export type Updater = Pick<KiwiBridge, "getUpdate" | "checkUpdate" | "installUpdate" | "onUpdate" | "openExternal">

const restart = async (b: Updater, version: string): Promise<void> => {
  if ((await b.installUpdate()) === false) throw new Error(t("live.update.not.in.place", { version }))
}

export const macDownload = (u: Pick<UpdateView, "version" | "url">): string =>
  u.url.includes("/releases/tag/") ? `${u.url.replace("/releases/tag/", "/releases/download/")}/Channels-${u.version}-mac-arm64.dmg` : u.url

export async function downloadAndRestart(b: Updater, say: (text: string) => void, stuck: () => Promise<boolean> = async () => false): Promise<void> {
  const u = await b.getUpdate()
  if (u && (await stuck())) return b.openExternal(macDownload(u))
  if (u?.state === "ready") return restart(b, u.version)
  if (u?.blocked) return b.openExternal(u.url)
  const next = u?.state === "downloading" ? u : await b.checkUpdate()
  if (next.state === "current") return say(t("live.update.current"))
  if (next.state === "failed") throw new Error(t("live.update.github.failed"))
  if (!u && (await stuck())) return b.openExternal(macDownload(next))
  if (next.state === "ready") return restart(b, next.version)
  if (next.state === "available") return b.openExternal(next.url)
  say(t("live.update.downloading", { version: next.version }))
  let done = false
  let off = () => {}
  const settle = (s: UpdateView | null) => {
    if (done || !s || s.version !== next.version || s.state === "downloading") return
    done = true
    off()
    if (s.state === "ready") void restart(b, s.version).catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
    else say(t("live.update.not.downloaded", { version: s.version }))
  }
  off = b.onUpdate(settle)
  if (done) off()
  settle(await b.getUpdate())
}

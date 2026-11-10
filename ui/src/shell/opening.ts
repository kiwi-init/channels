import type { App } from "~/model"
import type { Nav } from "~/nav"

export function opening(app: Pick<App, "channel" | "channels" | "gone">, nav: Pick<Nav, "page" | "channel">): boolean {
  if (nav.page !== "channel" || !nav.channel || app.channel || app.gone) return false
  const code = nav.channel
  return app.channels.some((c) => c.code === code && c.state === "member")
}

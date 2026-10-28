import type { UpdateCheck } from "~/model"

export function updateFound(u: UpdateCheck | null): string {
  if (!u) return "Channels looks for a newer release every few hours."
  switch (u.state) {
    case "current":
      return `Channels ${u.version} is the latest.`
    case "failed":
      return "Couldn't reach GitHub. Try again in a moment."
    case "downloading":
      return `Downloading Channels ${u.version}…`
    case "ready":
      return `Channels ${u.version} is ready. It goes in when you restart.`
    case "available":
      return u.blocked ? "Channels can't update itself here. Get it from the release." : `Channels ${u.version} is out.`
  }
}

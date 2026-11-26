import { compareVersions } from "@kiwi/core/versions.ts"
import type { KiwiBridge } from "@kiwi/secrets/secrets.ts"

const STUCK_FROM = "2026.11.16"
const STUCK_TO = "2026.11.24"

export const swapStuck = (platform: string, daemon: string | undefined): boolean =>
  /Mac/.test(platform) && !!daemon && compareVersions(daemon, STUCK_FROM) >= 0 && compareVersions(daemon, STUCK_TO) <= 0

export async function stuckHere(b: Pick<KiwiBridge, "daemonStatus">, platform: string = navigator.platform): Promise<boolean> {
  const daemon = await b.daemonStatus().catch(() => null)
  return swapStuck(platform, daemon?.version)
}

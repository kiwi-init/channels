import type { PermissionSettled, PermissionShown } from "@kiwi/core/permission.ts"
import { Cancel01Icon, CheckmarkCircle02Icon, CommandLineIcon } from "@hugeicons/core-free-icons"
import { useEffect, useState } from "react"

import { formatTime } from "@/lib/format"
import { permissionCode, type Settled } from "@/lib/permission-view"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

const CLOSED: Record<PermissionSettled, string> = {
  terminal: "Answered in the terminal",
  timeout: "No answer from the app: answer it in the terminal",
  ended: "The session ended",
}

function said(p: PermissionShown, settled: Settled | null | undefined, expired: boolean, nameOf: (name: string) => string): { text: string; tone: "live" | "alert" | "quiet" } {
  const answer = settled?.answer
  const choice = answer ? `${nameOf(answer.by)}’s ${answer.allow ? "Allow" : "Deny"}` : ""
  if (settled?.closed) return { text: answer ? `${CLOSED[settled.closed.kind]} first: ${choice} came too late` : CLOSED[settled.closed.kind], tone: "quiet" }
  if (answer) return { text: `${answer.allow ? "Allow once" : "Deny"} sent by ${nameOf(answer.by)} · ${formatTime(answer.at)}`, tone: answer.allow ? "live" : "alert" }
  if (expired) return { text: CLOSED.timeout, tone: "quiet" }
  return { text: `${p.tool} · waiting for an answer in Needs you or the terminal`, tone: "quiet" }
}

function useExpired(at: number): boolean {
  const [expired, setExpired] = useState(() => Date.now() > at)
  useEffect(() => {
    const id = setTimeout(() => setExpired(true), Math.max(0, at - Date.now()))
    return () => clearTimeout(id)
  }, [at])
  return expired
}

export function PermissionInThread({ p, settled, nameOf }: { p: PermissionShown; settled: Settled | null | undefined; nameOf: (name: string) => string }) {
  const expired = useExpired(p.expiresAt)
  const { text, tone } = said(p, settled, expired, nameOf)
  return (
    <div className="mt-2">
      <pre className="rounded-ctl bg-wash px-3 py-2 font-mono text-ui [overflow-wrap:anywhere] whitespace-pre-wrap text-ink">{permissionCode(p)}</pre>
      <p className={cx("mt-1.5 flex items-center gap-1.5 text-meta", tone === "live" ? "text-live" : tone === "alert" ? "text-alert" : "text-ink-3")}>
        <Icon icon={tone === "live" ? CheckmarkCircle02Icon : tone === "alert" ? Cancel01Icon : CommandLineIcon} size={14} className="shrink-0" />
        {text}
      </p>
    </div>
  )
}

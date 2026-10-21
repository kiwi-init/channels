import { Cancel01Icon, CheckmarkCircle02Icon, CommandLineIcon } from "@hugeicons/core-free-icons"

import { formatTime } from "@/lib/format"
import { permissionShown, type PermissionLike, type Settled } from "@/lib/permission-view"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

const SAID: Record<"terminal" | "timeout" | "ended", string> = {
  terminal: "Answered in the terminal",
  timeout: "No answer from the app: answer it in the terminal",
  ended: "The session ended",
}

export function PermissionInThread({ p, settled, nameOf }: { p: PermissionLike; settled: Settled | null | undefined; nameOf: (name: string) => string }) {
  const chose = settled && (settled.kind === "allowed" || settled.kind === "denied") ? settled : null
  return (
    <div className="mt-2">
      <pre className="rounded-ctl bg-wash px-3 py-2 font-mono text-ui [overflow-wrap:anywhere] whitespace-pre-wrap text-ink">{permissionShown(p)}</pre>
      <p className={cx("mt-1.5 flex items-center gap-1.5 text-meta", chose ? (chose.kind === "allowed" ? "text-live" : "text-alert") : "text-ink-3")}>
        <Icon icon={chose ? (chose.kind === "allowed" ? CheckmarkCircle02Icon : Cancel01Icon) : CommandLineIcon} size={14} className="shrink-0" />
        {chose
          ? `${chose.kind === "allowed" ? "Allowed once" : "Denied"} by ${nameOf(chose.by)} · ${formatTime(chose.at)}`
          : settled
            ? SAID[settled.kind as "terminal" | "timeout" | "ended"]
            : `${p.tool} · waiting for an answer in Needs you or the terminal`}
      </p>
    </div>
  )
}

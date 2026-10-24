import type { PermissionShown } from "@kiwi/core/permission.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import { useState } from "react"

import { formatAgo, formatTime } from "@/lib/format"
import { permissionCode, permissionNotes, permissionTitle, visibleText } from "@/lib/permission-view"
import type { PlacedSeat } from "@/lib/show-seat"
import { Button, Monogram, errorText, toast } from "./kit"
import { Row, ShowSeat } from "./needs-you"

export function PermissionItem({
  m,
  p,
  now,
  nameOf,
  onAnswer,
  seat,
  canAllow,
  canDeny,
  human,
}: {
  m: Message
  p: PermissionShown
  now: number
  nameOf: (n: string) => string
  onAnswer: (m: Message, allow: boolean) => Promise<void>
  seat?: PlacedSeat
  canAllow: boolean
  canDeny: boolean
  human: string | null
}) {
  const [busy, setBusy] = useState(false)
  const answer = (allow: boolean) => {
    setBusy(true)
    void onAnswer(m, allow)
      .then(
        () => toast(allow ? `Allow once sent to ${nameOf(m.from)}` : `Deny sent to ${nameOf(m.from)}`),
        (err) => toast(`Not sent: ${errorText(err)}`, "error")
      )
      .finally(() => setBusy(false))
  }
  const who = human ? nameOf(human) : "its own person"
  return (
    <Row
      lead={<Monogram name={nameOf(m.from)} hue={m.from} agent size={28} />}
      title={
        <>
          <span className="font-semibold">{nameOf(m.from)}</span>
          <span className="mx-1.5 rounded-row bg-decide-wash px-1.5 align-middle text-meta font-semibold text-decide">Permission</span>
          {permissionTitle(p)} <code className="ml-1 font-mono text-ui text-ink-2">{permissionCode(p).split("\n")[0]}</code>
        </>
      }
      detail={
        <>
          {p.description && <p className="text-ui text-ink-2">“{p.description}”</p>}
          <pre className="mt-1.5 rounded-ctl px-3 py-2 font-mono text-ui [overflow-wrap:anywhere] whitespace-pre-wrap text-ink edge">{permissionCode(p)}</pre>
          {p.replaced !== undefined && <Written label="Replaces" text={p.replaced} tone="text-alert" />}
          {p.content !== undefined && <Written label={p.replaced !== undefined ? "With" : undefined} text={p.content} tone="text-ink-2" />}
          {permissionNotes(p).map((note) => (
            <p key={note} className="mt-1.5 font-medium text-alert">
              {note}
            </p>
          ))}
          <p className="mt-1.5">{[p.tool, `in ${p.cwd}`, m.task ? taskId(m.task) : null, formatAgo(m.ts, now)].filter(Boolean).join(" · ")}</p>
          <p className="mt-1">Claude Code asks in its terminal too, and whichever answers first wins. This waits until {formatTime(p.expiresAt)}.</p>
          {p.canAllow && !canAllow && <p className="mt-1">Only {who} can allow it: it runs on their computer.</p>}
          {seat && (
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <ShowSeat seat={seat} />
            </span>
          )}
        </>
      }
    >
      {canDeny && (
        <Button size="sm" variant="secondary" className="text-alert" disabled={busy} onClick={() => answer(false)}>
          Deny
        </Button>
      )}
      {canAllow ? (
        <Button size="sm" disabled={busy} onClick={() => answer(true)}>
          Allow once
        </Button>
      ) : (
        p.canAllow && <span className="text-meta text-ink-3">Only {who} can allow</span>
      )}
    </Row>
  )
}

function Written({ label, text, tone }: { label?: string; text: string; tone: string }) {
  return (
    <>
      {label && <p className="mt-1.5 text-meta font-medium text-ink-3">{label}</p>}
      <pre className={`mt-1 max-h-48 overflow-auto rounded-ctl px-3 py-2 font-mono text-meta [overflow-wrap:anywhere] whitespace-pre-wrap edge ${tone}`}>{visibleText(text)}</pre>
    </>
  )
}

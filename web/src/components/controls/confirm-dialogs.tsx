import { useEffect, useState, type Dispatch, type SetStateAction } from "react"

import type { Scope } from "@kiwi/core/scopes.ts"
import { usePinned } from "@/lib/pinned"
import { memberName } from "@/lib/format"
import { AgentFacts } from "../agent-facts"
import { Alert, Button, errorText, TextField, toast } from "../kit"
import { exportNote, logFileName } from "@/lib/log-export"
import type { Persona } from "@kiwi/core/personality.ts"
import { PersonalityPicker } from "../personality-picker"
import { AddsAgentsPicker, ScopePicker } from "../scopes"
import type { Confirm, ControlsProps } from "./context"

export function ConfirmDialogs({
  p,
  confirm,
  setConfirm,
  busy,
  run,
  taken,
  scopeDraft,
  setScopeDraft,
  nickDraft,
  setNickDraft,
  personaDraft,
  setPersonaDraft,
}: {
  p: ControlsProps
  confirm: Confirm
  setConfirm: Dispatch<SetStateAction<Confirm>>
  busy: boolean
  run: (fn: () => Promise<void>, done: string) => Promise<void>
  taken: boolean
  scopeDraft: Scope[]
  setScopeDraft: Dispatch<SetStateAction<Scope[]>>
  nickDraft: string
  setNickDraft: Dispatch<SetStateAction<string>>
  personaDraft: Persona | null
  setPersonaDraft: Dispatch<SetStateAction<Persona | null>>
}) {
  const chosen = personaDraft
  const [saving, setSaving] = useState(false)
  const download = async () => {
    setSaving(true)
    try {
      const log = await p.exportLog()
      const url = URL.createObjectURL(new Blob([log.text], { type: "application/jsonl" }))
      const a = document.createElement("a")
      a.href = url
      a.download = logFileName(p.title, new Date())
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      const note = exportNote(log)
      toast(note.text, note.complete ? undefined : "error")
    } catch (err) {
      toast(`Not downloaded: ${errorText(err)}`, "error")
    } finally {
      setSaving(false)
    }
  }
  const pinnedAs = usePinned(confirm?.kind === "approve" ? confirm.req.pin : undefined)
  useEffect(() => {
    if (pinnedAs) setPersonaDraft(pinnedAs)
  }, [pinnedAs, setPersonaDraft])
  const [agentsPick, setAgentsPick] = useState<{ for: Confirm; on: boolean } | null>(null)
  const agentsDraft = agentsPick?.for === confirm ? agentsPick.on : confirm?.kind === "approve" && !!confirm.addsAgents
  const setAgentsDraft = (on: boolean) => setAgentsPick({ for: confirm, on })
  return (
    <>
      <Alert
        open={confirm?.kind === "persona"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "persona" ? `${confirm.member.name}’s personality` : ""}
        message={
          confirm?.kind === "persona" && (
            <span className="mt-3 grid gap-2">
              <PersonalityPicker
                current={p.state.members.get(confirm.member.name)?.persona}
                value={personaDraft}
                onChange={setPersonaDraft}
                lead={p.state.lead === confirm.member.name ? null : p.state.lead}
                disabled={busy}
              />
              <span className="text-meta text-ink-3">Every member's client holds it to what this personality may do from now on; what it sent before stands.</span>
            </span>
          )
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        {confirm?.kind === "persona" && p.onPersona && (
          <Button
            disabled={busy}
            onClick={() => {
              const m = confirm.member
              const next = personaDraft
              void run(() => p.onPersona!(m, next), next ? `${m.name} is ${next.name} now` : `${m.name} has no personality now`)
            }}
          >
            Save
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "nickname"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "nickname" ? `Nickname for @${confirm.member.name}` : ""}
        message={
          <span className="mt-3 grid gap-2">
            <TextField value={nickDraft} onChange={(e) => setNickDraft(e.target.value)} placeholder="Nickname, e.g. claude" maxLength={40} aria-label="Nickname" autoFocus />
            <span className="text-meta text-ink-3">What everyone sees. Others still reach it as @{confirm?.kind === "nickname" ? confirm.member.name : ""}, which never changes.</span>
          </span>
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        <Button
          disabled={busy || !p.onNickname}
          onClick={() => {
            if (confirm?.kind !== "nickname" || !p.onNickname) return
            const m = confirm.member
            const nick = nickDraft.trim()
            void run(() => p.onNickname!(m, nick || null), nick ? `@${m.name} is now ${nick}` : `@${m.name} has no nickname now`)
          }}
        >
          Save
        </Button>
      </Alert>

      <Alert
        open={confirm?.kind === "approve"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "approve" ? `Let ${confirm.req.name} in?` : ""}
        message={
          confirm?.kind === "approve" && (
            <>
              {confirm.req.kind !== "human" && <AgentFacts card={confirm.req.card} runs={confirm.req.runs} said repos={p.state.repos} className="mb-3" />}
              Approve only if {confirm.req.kind === "human" ? "they show" : "its terminal shows"} this exact code.
              <span className="mt-4 mb-4 block text-[34px] leading-none font-semibold tracking-[0.04em] text-ink tabular-nums">{confirm.req.code}</span>
              {confirm.req.kind === "human" ? (
                <>
                  <span className="mb-2 block text-ui font-medium text-ink">What they can do</span>
                  <ScopePicker value={scopeDraft} onChange={setScopeDraft} disabled={busy} />
                  <div className="mt-3">
                    <AddsAgentsPicker value={agentsDraft} onChange={setAgentsDraft} disabled={busy} />
                  </div>
                </>
              ) : (
                <>
                  <span className="mb-2 block text-ui font-medium text-ink">Personality</span>
                  <PersonalityPicker value={personaDraft} onChange={setPersonaDraft} lead={p.state.lead} disabled={busy} />
                </>
              )}
            </>
          )
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        {confirm?.kind === "approve" && (
          <Button
            disabled={busy || taken}
            onClick={() =>
              run(
                () => (confirm.req.kind !== "human" && chosen ? p.onApprove(confirm.req, undefined, chosen) : p.onApprove(confirm.req, scopeDraft, undefined, agentsDraft)),
                confirm.req.kind !== "human" && chosen ? `${confirm.req.name} joined as ${chosen.name}` : `${confirm.req.name} joined`
              )
            }
          >
            {taken ? "That name is taken" : confirm.req.kind !== "human" && chosen ? `Let in as ${chosen.name}` : "Approve"}
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "scopes"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "scopes" ? `Can ${confirm.member.name} only read?` : ""}
        message={
          confirm?.kind === "scopes" && (
            <>
              <span className="mb-3 block">Every member’s client holds them to this from now on; what they sent before stands.</span>
              <ScopePicker value={scopeDraft} onChange={setScopeDraft} disabled={busy} />
            </>
          )
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        {confirm?.kind === "scopes" && p.onScopes && (
          <Button disabled={busy} onClick={() => run(() => p.onScopes!(confirm.member, scopeDraft), `Saved what ${confirm.member.name} can do`)}>
            Save
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "remove"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "remove" ? `Remove ${memberName(confirm.member)}?` : ""}
        message="They’re disconnected at once, and the key rotates so they can’t read anything new."
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        {confirm?.kind === "remove" && (
          <Button className="bg-alert" disabled={busy} onClick={() => run(() => p.onRemove(confirm.member), `Removed ${confirm.member.name}`)}>
            Remove
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "close" || confirm?.kind === "leave"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "close" ? "Close this channel for everyone?" : "Leave this channel?"}
        message={
          confirm?.kind === "close" ? (
            <span className="grid gap-3">
              <span>Every message, member and key is deleted on the relay, and everyone’s copy is wiped the next time they connect. It can’t be recovered.</span>
              <span>Download the log first to keep it: every message with its author’s signature, so a message cited by number can still be checked.</span>
              <span>
                <Button variant="secondary" disabled={busy || saving} onClick={() => void download()}>
                  {saving ? "Downloading…" : "Download log"}
                </Button>
              </span>
            </span>
          ) : (
            "You lose access at once, and the key rotates so you can’t read anything newer. Coming back takes the owner’s approval."
          )
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        <Button
          className="bg-alert"
          disabled={busy || saving}
          onClick={() => run(confirm?.kind === "close" ? p.onCloseChannel : p.onLeaveChannel, confirm?.kind === "close" ? "Channel closed" : "You left the channel")}
        >
          {confirm?.kind === "close" ? "Close channel" : "Leave channel"}
        </Button>
      </Alert>
    </>
  )
}

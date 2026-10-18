import { useEffect, useState, type ReactNode } from "react"

import { nameKey } from "@kiwi/core/membership.ts"
import type { Event } from "@kiwi/core/protocol.ts"
import { SCOPES, type Scope } from "@kiwi/core/scopes.ts"
import { isPerson, LEAD } from "@kiwi/core/state.ts"
import { noteAgentWorked } from "@/lib/channel"
import { Modal, errorText, toast } from "../kit"
import { defaultScopes } from "../scopes"
import { CharterDialog, RenameDialog } from "./channel-dialogs"
import { ConfirmDialogs } from "./confirm-dialogs"
import { Ctx, type Api, type Confirm, type ControlsProps } from "./context"
import { Invite } from "./invite"
import { Requests } from "./requests"

export function ChannelControls({ children, ...p }: ControlsProps & { children: ReactNode }) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [sheet, setSheet] = useState<"requests" | "invite" | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<"rename" | "charter" | null>(null)
  const [roleDraft, setRoleDraft] = useState({ role: "", about: "" })
  const [scopeDraft, setScopeDraft] = useState<Scope[]>([...SCOPES])
  const [nickDraft, setNickDraft] = useState("")
  const active = p.roster.filter((m) => m.active)
  if (confirm?.kind === "approve" && active.some((m) => m.pk === confirm.req.pk)) setConfirm(null)
  const taken = confirm?.kind === "approve" && active.some((m) => m.pk !== confirm.req.pk && nameKey(m.name) === nameKey(confirm.req.name))
  const lastSeenOf = (name: string) => p.state.members.get(name)?.lastSeen || null
  const onlineNow = (name: string) => p.online.has(name) || p.now - (lastSeenOf(name) ?? 0) < 10 * 60_000

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast(done)
      setConfirm(null)
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const setRole = (ev: Extract<Event, { op: "role.set" | "role.refuse" }>) => p.onRole(ev)

  const agentHere = [...p.state.members.values()].some((m) => m.active && !isPerson(m) && !!m.card)
  useEffect(() => {
    if (agentHere) noteAgentWorked()
  }, [agentHere])

  const api: Api = {
    p,
    busy,
    run,
    ask: (c) => {
      if (c?.kind === "approve") {
        setScopeDraft(p.roomId ? defaultScopes(p.roomId) : [...SCOPES])
      }
      setConfirm(c)
    },
    openRequests: () => setSheet("requests"),
    openInvite: () => setSheet("invite"),
    setLead: (m, on) => run(() => setRole({ op: "role.set", member: m.name, role: on ? LEAD : null }), on ? `${m.name} is the lead` : `${m.name} isn't the lead any more`),
    setRole,
    editRole: (m) => {
      const live = p.state.members.get(m.name)
      setRoleDraft({ role: live?.role ?? "", about: live?.about ?? "" })
      setConfirm({ kind: "role", member: m })
    },
    editScopes: (m) => {
      const now = p.state.members.get(m.name)?.scopes
      setScopeDraft(now && now.length === 0 ? [] : [...SCOPES])
      setConfirm({ kind: "scopes", member: m })
    },
    editNickname: (m) => {
      setNickDraft(m.display ?? "")
      setConfirm({ kind: "nickname", member: m })
    },
    lastSeenOf,
    onlineNow,
    openDialog: setDialog,
  }

  return (
    <Ctx.Provider value={api}>
      {children}

      {p.onRename && dialog === "rename" && <RenameDialog title={p.title ?? ""} onClose={() => setDialog(null)} onSave={p.onRename} />}
      {dialog === "charter" && <CharterDialog text={p.state.charter?.text ?? ""} onClose={() => setDialog(null)} onSave={p.isOwner ? p.onCharter : undefined} />}

      <Modal open={sheet === "requests" && confirm === null} onClose={() => setSheet(null)} wide>
        <Requests onDone={() => setSheet(null)} />
      </Modal>
      <Modal open={sheet === "invite"} onClose={() => setSheet(null)} wide>
        <Invite onDone={() => setSheet(null)} />
      </Modal>

      <ConfirmDialogs
        p={p}
        confirm={confirm}
        setConfirm={setConfirm}
        busy={busy}
        run={run}
        setRole={setRole}
        taken={taken}
        roleDraft={roleDraft}
        setRoleDraft={setRoleDraft}
        scopeDraft={scopeDraft}
        setScopeDraft={setScopeDraft}
        nickDraft={nickDraft}
        setNickDraft={setNickDraft}
      />
    </Ctx.Provider>
  )
}

import { useEffect, useState, type ReactNode } from "react"

import { nameKey } from "@kiwi/core/membership.ts"
import { SCOPES, type Scope } from "@kiwi/core/scopes.ts"
import { isPerson } from "@kiwi/core/state.ts"
import { noteAgentWorked } from "@/lib/channel"
import { errorText, toast } from "../kit"
import type { Persona } from "@kiwi/core/personality.ts"
import { defaultScopes } from "../scopes"
import { BranchPrefixDialog, CharterDialog, ConfirmDialogs, RenameDialog } from "../lazy"
import { Ctx, type Api, type Confirm, type ControlsProps } from "./context"

export function ChannelControls({ children, ...p }: ControlsProps & { children: ReactNode }) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<"rename" | "charter" | "branch" | null>(null)
  const [scopeDraft, setScopeDraft] = useState<Scope[]>([...SCOPES])
  const [nickDraft, setNickDraft] = useState("")
  const [handleDraft, setHandleDraft] = useState("")
  const [personaDraft, setPersonaDraft] = useState<Persona | null>(null)
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
        setPersonaDraft(null)
      }
      setConfirm(c)
    },
    editScopes: (m) => {
      const now = p.state.members.get(m.name)?.scopes
      setScopeDraft(now && now.length === 0 ? [] : [...SCOPES])
      setConfirm({ kind: "scopes", member: m })
    },
    editPersona: (m) => {
      setPersonaDraft(p.state.members.get(m.name)?.persona ?? null)
      setConfirm({ kind: "persona", member: m })
    },
    editNickname: (m) => {
      setNickDraft(m.display ?? "")
      setConfirm({ kind: "nickname", member: m })
    },
    editHandle: (m) => {
      setHandleDraft(m.name)
      setConfirm({ kind: "handle", member: m })
    },
    editColor: (m) => setConfirm({ kind: "color", member: m }),
    lastSeenOf,
    onlineNow,
    openDialog: setDialog,
  }

  return (
    <Ctx.Provider value={api}>
      {children}

      {p.onRename && dialog === "rename" && <RenameDialog title={p.title ?? ""} onClose={() => setDialog(null)} onSave={p.onRename} />}
      {dialog === "charter" && <CharterDialog text={p.state.charter?.text ?? ""} onClose={() => setDialog(null)} onSave={p.isOwner ? p.onCharter : undefined} />}
      {dialog === "branch" && <BranchPrefixDialog prefix={p.state.branchPrefix} onClose={() => setDialog(null)} onSave={p.isOwner ? p.onBranchPrefix : undefined} />}

      {confirm !== null && (
        <ConfirmDialogs
          p={p}
          confirm={confirm}
          setConfirm={setConfirm}
          busy={busy}
          run={run}
          taken={taken}
          scopeDraft={scopeDraft}
          setScopeDraft={setScopeDraft}
          nickDraft={nickDraft}
          setNickDraft={setNickDraft}
          handleDraft={handleDraft}
          setHandleDraft={setHandleDraft}
          personaDraft={personaDraft}
          setPersonaDraft={setPersonaDraft}
        />
      )}
    </Ctx.Provider>
  )
}

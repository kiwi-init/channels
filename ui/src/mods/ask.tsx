import "~/styles/mods.css"

import { useState } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { ModRoom, ModSnippet, ModView } from "../../../desktop/src/bridge.ts"
import { Modal } from "~/kit/modal"
import { askLater, askWaiting, useModsVersion } from "~/mods/host"
import { ModIcon } from "~/mods/icon"
import { asksRooms, needWords, RoomPicker, startPick } from "~/mods/needs"
import { useApp } from "~/nav"

function Snippet({ snippet, into }: { snippet: ModSnippet; into: string }) {
  return (
    <div className="mod-snippet">
      <p>
        It adds this line to <code>{snippet.file}</code>
        {into}:
      </p>
      <pre>{snippet.line}</pre>
      <p>which loads:</p>
      <pre>{snippet.text}</pre>
    </div>
  )
}

function AskBody({ mod, rooms }: { mod: ModView; rooms: { value: ModRoom[]; onChange: (next: ModRoom[]) => void } | null }) {
  const { app } = useApp()
  const more = mod.approved.length > 0
  return (
    <div className="mod-ask">
      {mod.why && <p className="mod-why">{mod.why}</p>}
      <p>{more ? "It asks for more than you allowed. To keep working, it needs:" : "It runs in its own frame, away from your keys and messages. To work, it asks for:"}</p>
      <ul className="mod-needs">
        {mod.needs.map((n) => (
          <li key={n}>
            {needWords(n)}
            {more && !mod.approved.includes(n) && <span className="tone-decide"> · new</span>}
          </li>
        ))}
      </ul>
      {rooms && <RoomPicker rooms={asksRooms(mod.needs)} channels={app.channels.filter((c) => c.state === "member")} value={rooms.value} onChange={rooms.onChange} />}
      {mod.terminal?.tmux && <Snippet snippet={mod.terminal.tmux} into=" for tmux" />}
      {mod.terminal?.rex && <Snippet snippet={mod.terminal.rex} into=" for Rex" />}
      {mod.terminal && <p>Removing the mod takes these lines back out.</p>}
    </div>
  )
}

export function ModAsk() {
  useModsVersion()
  const { app, nav, go, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [pick, setPick] = useState<{ name: string; rooms: ModRoom[] } | null>(null)
  const mod = askWaiting()
  if (!mod || nav.dialog || nav.modal || (nav.page !== "settings" && !app.channel)) return null
  const asked = asksRooms(mod.needs)
  const picked = pick?.name === mod.name ? pick.rooms : startPick(asked, app.channel)
  const allow = () => {
    const b = bridge()
    if (!b) return
    setBusy(mod.name)
    b.approveMod(mod.name, mod.needs, asked.length ? picked : []).then(
      () => {
        setBusy(null)
        if (mod.needs.includes("panel") && nav.page === "channel") go({ to: "panel", panel: { kind: "mod", name: mod.name } })
      },
      (e: unknown) => {
        setBusy(null)
        toast(e instanceof Error ? e.message : String(e), "error")
      }
    )
  }
  return (
    <Modal
      key={mod.name}
      dismiss="x"
      label={`${mod.name} asks to run`}
      title={mod.name}
      sub={mod.version ? `asks to run · ${mod.version}` : "asks to run"}
      lead={<ModIcon name={mod.name} icon={mod.icon} />}
      onClose={() => askLater(mod)}
      foot={
        <>
          <button type="button" className="btn is-quiet" onClick={() => askLater(mod)}>
            Not now
          </button>
          <button type="button" className="btn is-primary" disabled={busy === mod.name} onClick={allow}>
            Allow
          </button>
        </>
      }
    >
      <AskBody mod={mod} rooms={asked.length ? { value: picked, onChange: (rooms) => setPick({ name: mod.name, rooms }) } : null} />
    </Modal>
  )
}

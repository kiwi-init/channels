import { Copy01Icon } from "@hugeicons/core-free-icons"
import { Fragment, useEffect, useState } from "react"

import type { PersonPowers } from "@kiwi/core/membership.ts"
import type { Persona } from "@kiwi/core/personality.ts"
import { SCOPES, type Scope } from "@kiwi/core/scopes.ts"
import { usePersonalities } from "@kiwi/app/personalities.ts"
import { kiwiJoin } from "@kiwi/app/join-line.ts"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { Icon } from "../icon"
import { IconButton, Tabs, TextField, toast } from "../kit"
import { PersonalityPicker } from "../personality-picker"
import { defaultPowers, defaultScopes, PowersPicker, saveDefaultPowers, saveDefaultScopes, ScopePicker } from "../scopes"
import { useControls } from "./context"

function CopyBox({ text, label, done }: { text: string; label: string; done: string }) {
  const [head, ...flags] = text.split(/\s(?=--[a-z])/)
  return (
    <div className="flex items-start gap-1 rounded-ctl bg-wash p-2.5">
      <code className="min-w-0 flex-1 font-mono text-meta leading-relaxed [overflow-wrap:anywhere] text-ink-2">
        {head}
        {flags.map((flag, i) => (
          <Fragment key={i}>
            {" "}
            <span className={/^\S+\s\S+$/.test(flag) ? "inline-block break-all" : "inline-block"}>{flag}</span>
          </Fragment>
        ))}
      </code>
      <IconButton label={label} className="size-7" onClick={() => navigator.clipboard.writeText(text).then(() => toast(done))}>
        <Icon icon={Copy01Icon} size={15} />
      </IconButton>
    </div>
  )
}

const inviteLink = (code: string) => `${relayUrl()}/#${code}`

export function Invite() {
  const { p } = useControls()
  const [who, setWho] = useState<"person" | "agent">("agent")
  const [nick, setNick] = useState("")
  const [rules, setRules] = useState("")
  const [newScopes, setNewScopes] = useState<Scope[]>(() => (p.roomId ? defaultScopes(p.roomId) : [...SCOPES]))
  const [powers, setPowers] = useState<PersonPowers>(() => (p.roomId ? defaultPowers(p.roomId) : {}))
  const [joinsAs, setJoinsAs] = useState<Persona | null>(null)
  const [signed, setSigned] = useState<{ name: string; token: string } | null>(null)
  const onPin = p.onPin
  const all = usePersonalities()
  const chosen = joinsAs ? all.find((x) => x.name === joinsAs.name) : undefined
  useEffect(() => {
    if (!chosen || !onPin) return
    let live = true
    onPin(chosen)
      .then((token) => live && setSigned({ name: chosen.name, token }))
      .catch(() => {
        // Without a pin the command still works: the owner picks the personality at Let in.
      })
    return () => {
      live = false
    }
  }, [chosen, onPin])
  const pin = chosen && signed?.name === chosen.name ? signed.token : null
  const command = `kiwi ${kiwiJoin(relayUrl(), p.code, { nick, about: rules, persona: pin })}`

  return (
    <div className="px-4 pt-1 pb-6">
      <h2 className="text-title font-semibold tracking-[-0.01em]">Invite to this channel</h2>
      <p className="mt-1 text-ui leading-normal text-ink-2">Everyone who joins waits for you to approve them with a 6-digit code.</p>
      <div className="mt-4">
        <Tabs
          stretch
          label="Who you're inviting"
          value={who}
          onChange={setWho}
          options={[
            { value: "agent", label: "An agent" },
            { value: "person", label: "A person" },
          ]}
        />
      </div>
      {who === "person" ? (
        <div role="tabpanel" aria-label="A person" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="text-ui leading-normal text-ink-2">Send them this link. They open it and ask to join.</p>
          <CopyBox text={inviteLink(p.code)} label="Copy link" done="Invite link copied" />
        </div>
      ) : (
        <div role="tabpanel" aria-label="An agent" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2">
          <TextField value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Nickname (optional)" maxLength={40} aria-label="Nickname" />
          <TextField value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Rules, e.g. only web/; ask before changing APIs" maxLength={200} aria-label="Rules" />
          {onPin && (
            <>
              <span className="mt-2 text-ui font-medium text-ink">
                Joins as <span className="font-normal text-ink-3">· pinned in the command; you let it in as this</span>
              </span>
              <PersonalityPicker value={joinsAs} onChange={setJoinsAs} lead={p.state.lead} />
            </>
          )}
          <CopyBox text={command} label="Copy command" done="Join command copied" />
          <p className="text-meta text-ink-3">
            Run it on a computer set up with <span className="font-mono">kiwi setup</span>.
          </p>
        </div>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-ui font-medium text-ink">
          New members can <span className="font-normal text-ink-3">· you confirm it when you approve each one</span>
        </p>
        <ScopePicker value={newScopes} onChange={(s) => (setNewScopes(s), p.roomId && saveDefaultScopes(p.roomId, s))} />
        {who === "person" && (
          <div className="mt-3">
            <PowersPicker value={powers} onChange={(next) => (setPowers(next), p.roomId && saveDefaultPowers(p.roomId, next))} />
          </div>
        )}
      </div>
    </div>
  )
}

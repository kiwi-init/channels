import { Dialog } from "@base-ui/react/dialog"
import { Copy01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts"
import { SCOPES, type Scope } from "@kiwi/core/scopes.ts"
import { relayUrl } from "@/lib/relay"
import { Icon } from "../icon"
import { Button, IconButton, Tabs, TextField, toast } from "../kit"
import { defaultScopes, saveDefaultScopes, ScopePicker } from "../scopes"
import { useControls } from "./context"

function CopyBox({ text, label, done }: { text: string; label: string; done: string }) {
  return (
    <div className="flex items-start gap-1 rounded-ctl bg-wash p-2.5">
      <code className="min-w-0 flex-1 font-mono text-meta leading-relaxed [overflow-wrap:anywhere] text-ink-2">
        {text.split(/(?=\s--[a-z])/).map((part, i) => (
          <span key={i} className={i > 0 ? "whitespace-nowrap" : undefined}>
            {part}
          </span>
        ))}
      </code>
      <IconButton label={label} className="size-7" onClick={() => navigator.clipboard.writeText(text).then(() => toast(done))}>
        <Icon icon={Copy01Icon} size={15} />
      </IconButton>
    </div>
  )
}

const inviteLink = (code: string) => `${relayUrl()}/#${code}`

const quoted = (s: string) => `'${s.replace(/'/g, "’")}'`

const ROLES = ["designer", "frontend", "backend", "reviewer", "tester", "docs", "intern"]

export function Invite({ onDone }: { onDone: () => void }) {
  const { p } = useControls()
  const [who, setWho] = useState<"person" | "agent">("agent")
  const [nick, setNick] = useState("")
  const [role, setRole] = useState("")
  const [rules, setRules] = useState("")
  const [newScopes, setNewScopes] = useState<Scope[]>(() => (p.roomId ? defaultScopes(p.roomId) : [...SCOPES]))
  const nickname = nick.trim()
  const command = [
    `kiwi join ${p.code}`,
    relayUrl() !== DEFAULT_RELAY && `--relay ${relayUrl()}`,
    nickname && `--nick ${quoted(nickname)}`,
    role.trim() && `--role ${quoted(role.trim())}`,
    rules.trim() && `--about ${quoted(rules.trim())}`,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className="p-5">
      <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Invite to this channel</Dialog.Title>
      <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">Everyone who joins waits for you to approve them with a 6-digit code.</Dialog.Description>
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
        <div role="tabpanel" aria-label="A person" className="mt-4 grid gap-2">
          <p className="text-ui leading-normal text-ink-2">Send them this link. They open it and ask to join.</p>
          <CopyBox text={inviteLink(p.code)} label="Copy link" done="Invite link copied" />
        </div>
      ) : (
        <div role="tabpanel" aria-label="An agent" className="mt-4 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <TextField value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Nickname (optional)" maxLength={40} aria-label="Nickname" />
            <TextField value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" maxLength={60} list="kiwi-roles" aria-label="Role" />
          </div>
          <TextField value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Rules, e.g. only web/; ask before changing APIs" maxLength={200} aria-label="Rules" />
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
      </div>
      <datalist id="kiwi-roles">
        {ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

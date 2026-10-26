import { Add01Icon, ArrowRight01Icon, Key01Icon, ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons"
import { useEffect, useId, useState, type FormEvent } from "react"

import type { Member } from "@kiwi/core/membership.ts"
import { grantable, MAX_SECRET_NOTE, MAX_SECRET_VALUE, secretNameProblem, secretValueProblem, type SecretView } from "@kiwi/core/secrets.ts"
import { colorOf } from "@kiwi/core/state.ts"
import { memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { useControls } from "./context"
import { Icon } from "../icon"
import { Button, Checkbox, Monogram, TextField, errorText, toast } from "../kit"

const asName = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9_]/g, "_")

const sameSet = (a: readonly string[], b: ReadonlySet<string>) => a.length === b.size && a.every((x) => b.has(x))

type Loaded = { kind: "loading" } | { kind: "failed"; why: string } | { kind: "ready"; list: SecretView[] }

export function Secrets() {
  const { p } = useControls()
  const api = p.secrets
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" })
  const [editing, setEditing] = useState<SecretView | "new" | null>(null)
  const agents = p.roster.filter(grantable)
  const whoIs = (pk: string) => {
    const m = p.roster.find((r) => r.pk === pk)
    return m ? memberName(m) : `${pk.slice(0, 8)}…`
  }

  const load = () => {
    if (!api) return
    void api.list().then(
      (list) => setLoaded({ kind: "ready", list }),
      (err: unknown) => setLoaded({ kind: "failed", why: errorText(err) })
    )
  }
  useEffect(load, [api])

  if (!api) return null
  if (editing)
    return (
      <SecretForm
        secret={editing === "new" ? null : editing}
        taken={loaded.kind === "ready" ? loaded.list.filter((s) => s !== editing).map((s) => s.name) : []}
        agents={agents}
        whoIs={whoIs}
        done={(changed) => {
          setEditing(null)
          if (changed) load()
        }}
      />
    )

  return (
    <div className="px-4 pt-1 pb-6">
      <h2 className="text-title font-semibold tracking-[-0.01em]">Secrets</h2>
      <p className="mt-1 text-ui leading-normal text-ink-2">
        Keys, tokens and passwords your agents use without seeing them. Each one is sealed to the agents you pick: nobody else in the channel can read it, and neither can the relay.
      </p>

      {loaded.kind === "loading" && <p className="mt-4 text-ui text-ink-3">Loading…</p>}
      {loaded.kind === "failed" && <p className="mt-4 text-ui leading-normal text-alert">{loaded.why}</p>}
      {loaded.kind === "ready" &&
        (loaded.list.length ? (
          <ul aria-label="This channel's secrets" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-1">
            {loaded.list.map((s) => {
              const users = s.grants.filter((pk) => agents.some((a) => a.pk === pk))
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => setEditing(s)} className="flex w-full items-center gap-3 rounded-row px-3 py-2 text-left edge transition-colors hover:bg-wash">
                    <Icon icon={Key01Icon} size={15} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-ui font-semibold">{s.name}</span>
                      <span className="block truncate text-meta text-ink-3">{users.length ? users.map(whoIs).join(", ") : "No agent can use it yet"}</span>
                    </span>
                    <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-ink-3" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-4 text-ui text-ink-3">No secrets yet.</p>
        ))}

      <div className="mt-5 flex justify-end">
        <Button disabled={loaded.kind !== "ready"} onClick={() => setEditing("new")}>
          <Icon icon={Add01Icon} size={15} />
          New secret
        </Button>
      </div>

      <p className="mt-6 text-meta leading-normal text-ink-3">
        An agent runs a command with its secrets in that command’s environment (<span className="font-mono">kiwi secret run</span>). Kiwi writes [secret NAME] wherever a value would show in the
        output, and refuses to send a message that holds one.
      </p>
    </div>
  )
}

function SecretForm({ secret, taken, agents, whoIs, done }: { secret: SecretView | null; taken: string[]; agents: Member[]; whoIs: (pk: string) => string; done: (changed: boolean) => void }) {
  const { p } = useControls()
  const api = p.secrets!
  const [name, setName] = useState(secret?.name ?? "")
  const [value, setValue] = useState("")
  const [note, setNote] = useState(secret?.note ?? "")
  const [grants, setGrants] = useState<ReadonlySet<string>>(() => new Set(secret?.grants ?? []))
  const [shown, setShown] = useState<string | null>(null)
  const [masked, setMasked] = useState(true)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const id = useId()

  const nameProblem = name ? (secretNameProblem(name) ?? (taken.includes(name) ? `There is already a secret named ${name}.` : null)) : null
  const valueProblem = value ? secretValueProblem(value) : null
  const changed = !secret || name !== secret.name || value !== "" || (note.trim() || null) !== secret.note || !sameSet(secret.grants, grants)
  const ready = !!name && !nameProblem && !valueProblem && (!!secret || !!value) && changed
  const lost = secret && !value ? secret.had.filter((pk) => !grants.has(pk)) : []

  const toggle = (pk: string) => setGrants((g) => (g.has(pk) ? new Set([...g].filter((x) => x !== pk)) : new Set([...g, pk])))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      await api.save({ ...(secret ? { id: secret.id } : {}), name, ...(value ? { value } : {}), note: note.trim() || null, grants: [...grants] })
      toast(`${name} saved`)
      done(true)
    } catch (err) {
      toast(errorText(err), "error")
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!secret) return
    setBusy(true)
    try {
      await api.remove(secret.id)
      toast(`${secret.name} deleted`)
      done(true)
    } catch (err) {
      toast(errorText(err), "error")
      setBusy(false)
    }
  }

  const reveal = async () => {
    if (!secret) return
    if (shown !== null) return setShown(null)
    try {
      setShown(await api.value(secret.id))
    } catch (err) {
      toast(errorText(err), "error")
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="px-4 pt-1 pb-6">
      <h2 className={cx("truncate text-title font-semibold tracking-[-0.01em]", secret && "font-mono")}>{secret ? secret.name : "New secret"}</h2>

      <div className="mt-4">
        <label htmlFor={`${id}-name`} className="text-ui font-medium">
          Name
        </label>
        <div className="mt-1.5 font-mono">
          <TextField
            id={`${id}-name`}
            autoFocus={!secret}
            value={name}
            onChange={(e) => setName(asName(e.target.value))}
            placeholder="STRIPE_KEY"
            spellCheck={false}
            autoComplete="off"
            maxLength={64}
            className="placeholder:font-sans"
            aria-invalid={!!nameProblem}
            aria-describedby={`${id}-name-hint`}
          />
        </div>
        <p id={`${id}-name-hint`} className={cx("mt-1 text-meta leading-normal", nameProblem ? "text-alert" : "text-ink-3")}>
          {nameProblem ?? `What a command reads it as: $${name || "STRIPE_KEY"}`}
        </p>
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-value`} className="flex-1 text-ui font-medium">
            {secret ? "New value" : "Value"}
          </label>
          <button type="button" onClick={() => setMasked((m) => !m)} className="flex items-center gap-1 rounded-row px-1.5 py-0.5 text-meta text-ink-3 transition-colors hover:bg-wash hover:text-ink">
            <Icon icon={masked ? ViewIcon : ViewOffSlashIcon} size={13} />
            {masked ? "Show" : "Hide"}
          </button>
        </div>
        <div className="font-mono">
          <textarea
            id={`${id}-value`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={secret ? "Unchanged. Paste a new value to replace it" : "Paste the key, token or password"}
            rows={2}
            maxLength={MAX_SECRET_VALUE}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-invalid={!!valueProblem}
            className={cx(
              "mt-1.5 block w-full resize-y rounded-ctl bg-canvas px-3 py-2 text-ui text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:font-sans placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1px_var(--ring),0_0_0_3px_var(--wash-2)] focus-visible:outline-none",
              masked && value && "[-webkit-text-security:disc]"
            )}
          />
        </div>
        {valueProblem && <p className="mt-1 text-meta leading-normal text-alert">{valueProblem}</p>}
      </div>
      {secret && (
        <div className="mt-2">
          <button type="button" onClick={() => void reveal()} className="rounded-row px-1.5 py-0.5 text-meta text-accent-text transition-colors hover:bg-wash">
            {shown === null ? "Show the current value" : "Hide the current value"}
          </button>
          {shown !== null && <pre className="mt-1.5 max-h-40 overflow-auto rounded-ctl px-3 py-2 font-mono text-ui break-all whitespace-pre-wrap edge select-all">{shown}</pre>}
        </div>
      )}

      <div className="mt-4">
        <label htmlFor={`${id}-note`} className="text-ui font-medium">
          Note
        </label>
        <TextField id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it’s for. Agents see this" maxLength={MAX_SECRET_NOTE} className="mt-1.5" />
      </div>

      <fieldset className="mt-5">
        <legend className="text-ui font-medium">Agents that can use it</legend>
        {agents.length ? (
          <ul className="mt-1.5 grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {agents.map((m) => (
              <li key={m.pk}>
                <label
                  className={cx(
                    "flex cursor-pointer items-center gap-3 rounded-row border px-3 py-1.5 transition-colors",
                    grants.has(m.pk) ? "border-accent bg-accent-wash" : "border-transparent hover:bg-wash"
                  )}
                >
                  <Checkbox checked={grants.has(m.pk)} onChange={() => toggle(m.pk)} aria-label={`${memberName(m)} can use it`} />
                  <Monogram name={memberName(m)} hue={m.name} agent size={24} online={p.online.has(m.name)} color={colorOf(p.state, m.name)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui font-semibold">{memberName(m)}</span>
                    {m.from?.label && <span className="block truncate text-meta text-ink-3">on {m.from.label}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-ui text-ink-3">No agents in this channel yet. You can add the secret now and pick them later.</p>
        )}
      </fieldset>

      {lost.length > 0 && (
        <p className="mt-4 rounded-card bg-decide-wash px-4 py-3 text-ui leading-normal">
          {lost.map(whoIs).join(", ")} {lost.length === 1 ? "has" : "have"} seen this value. Taking it back stops them using it through Kiwi; to be sure, replace the value at its source and paste the
          new one here.
        </p>
      )}

      {deleting ? (
        <div className="mt-5 flex items-center gap-2">
          <span className="min-w-0 flex-1 text-ui">Delete {secret?.name}? Agents lose it at once.</span>
          <Button variant="secondary" onClick={() => setDeleting(false)}>
            Keep
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2">
          {secret && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="secondary" onClick={() => done(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !ready}>
            Save
          </Button>
        </div>
      )}
    </form>
  )
}

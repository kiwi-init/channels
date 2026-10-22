import { Cancel01Icon, LockIcon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { useEffect, useState } from "react"

import { MAX_REPOS, REPO_RE } from "@kiwi/core/protocol.ts"
import { reposOf } from "@kiwi/core/state.ts"
import { formatShort } from "@/lib/format"
import { bridge, type GithubRepoView } from "@/lib/secrets"
import { cx } from "@/lib/utils"
import { Icon } from "../icon"
import { Button, errorText, toast } from "../kit"

const SHOWN = 40

const nameOf = (raw: string) =>
  raw
    .trim()
    .replace(/^(?:https?:\/\/)?github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")

export type Reach = { kind: "loading" } | { kind: "none"; why: string } | { kind: "repos"; list: GithubRepoView[] }

function useReachable(): Reach {
  const [reach, setReach] = useState<Reach>(() => (bridge()?.githubRepos ? { kind: "loading" } : { kind: "none", why: "Pick from your repos in the desktop app, once GitHub is linked in Settings." }))
  useEffect(() => {
    const b = bridge()
    if (!b?.githubRepos) return
    let live = true
    const repos = b.githubRepos().then(
      (list) => ({ list }),
      (err: unknown) => ({ err })
    )
    void b
      .githubStatus()
      .then(async (s) => {
        if (!s.account) return live && setReach({ kind: "none", why: "Link GitHub in Settings to pick from your repos." })
        const got = await repos
        if (!live) return
        setReach("list" in got ? { kind: "repos", list: got.list } : { kind: "none", why: `Couldn’t list your repos: ${errorText(got.err)}` })
      })
      .catch((err: unknown) => live && setReach({ kind: "none", why: `Couldn’t list your repos: ${errorText(err)}` }))
    return () => {
      live = false
    }
  }, [])
  return reach
}

export function Repos({ repos, onSave }: { repos: string[]; onSave?: (repos: string[]) => Promise<void> }) {
  return <ReposView repos={repos} onSave={onSave} reach={useReachable()} />
}

export function ReposView({ repos, onSave, reach, initialQuery = "" }: { repos: string[]; onSave?: (repos: string[]) => Promise<void>; reach: Reach; initialQuery?: string }) {
  const [draft, setDraft] = useState(repos)
  const [query, setQuery] = useState(initialQuery)
  const [busy, setBusy] = useState(false)
  const chosen = new Set(draft.map((r) => r.toLowerCase()))
  const typed = nameOf(query)
  const q = typed.toLowerCase()
  const found = reach.kind === "repos" ? reach.list.filter((r) => !q || r.fullName.toLowerCase().includes(q)).slice(0, SHOWN) : []
  const addable = REPO_RE.test(typed) && !chosen.has(q) && !found.some((r) => r.fullName.toLowerCase() === q)
  const full = draft.length >= MAX_REPOS
  const same = reposOf(draft).join("\n") === repos.join("\n")

  const toggle = (name: string) => setDraft((d) => (d.some((r) => r.toLowerCase() === name.toLowerCase()) ? d.filter((r) => r.toLowerCase() !== name.toLowerCase()) : full ? d : [...d, name]))
  const save = async () => {
    setBusy(true)
    try {
      const next = reposOf(draft)
      await onSave!(next)
      toast(next.length ? "Repos saved" : "Repos cleared")
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 pt-1 pb-6">
      <h2 className="text-title font-semibold tracking-[-0.01em]">Repos</h2>
      <p className="mt-1 text-ui leading-normal text-ink-2">The GitHub repositories this channel works on. An agent that joins or works from any other repo is flagged.</p>

      {draft.length > 0 ? (
        <ul aria-label="This channel's repos" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-1">
          {draft.map((r) => (
            <li key={r} className="flex items-center gap-2 rounded-row edge px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-ui">{r}</span>
              {onSave && (
                <button type="button" aria-label={`Remove ${r}`} onClick={() => toggle(r)} className="shrink-0 rounded-row p-1 text-ink-3 transition-colors hover:bg-wash hover:text-ink">
                  <Icon icon={Cancel01Icon} size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-ui text-ink-3">No repos yet.</p>
      )}

      {onSave && (
        <>
          <label className="mt-5 flex h-9 items-center gap-2 rounded-ctl edge px-3 text-ink-3 focus-within:shadow-[inset_0_0_0_1px_var(--ring)]">
            <Icon icon={Search01Icon} size={15} className="shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                e.preventDefault()
                const pick = addable ? typed : found.length === 1 ? found[0]!.fullName : null
                if (pick && !chosen.has(pick.toLowerCase())) toggle(pick)
                if (pick) setQuery("")
              }}
              spellCheck={false}
              placeholder={reach.kind === "repos" ? "Search your repos, or type owner/repo" : "owner/repo"}
              aria-label="Find a repo"
              className="min-w-0 flex-1 bg-transparent font-mono text-ui text-ink outline-none placeholder:font-sans placeholder:text-ink-3 focus-visible:outline-none"
            />
          </label>

          <ul aria-label="Repos to add" className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {addable && (
              <li>
                <button
                  type="button"
                  disabled={full}
                  onClick={() => (toggle(typed), setQuery(""))}
                  className="flex w-full items-center gap-2 rounded-row px-3 py-1.5 text-left text-ui transition-colors hover:bg-wash disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">
                    Add <span className="font-mono">{typed}</span>
                  </span>
                </button>
              </li>
            )}
            {found.map((r) => {
              const on = chosen.has(r.fullName.toLowerCase())
              return (
                <li key={r.fullName}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() => toggle(r.fullName)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-row border px-3 py-1.5 text-left text-ui transition-colors disabled:opacity-50",
                      on ? "border-accent bg-accent-wash" : "border-transparent hover:bg-wash"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{r.fullName}</span>
                    {r.private && <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />}
                    {r.pushedAt > 0 && <span className="shrink-0 text-meta text-ink-3 tabular-nums">{formatShort(r.pushedAt)}</span>}
                    {on && <Icon icon={Tick02Icon} size={15} className="shrink-0 text-accent-text" />}
                  </button>
                </li>
              )
            })}
          </ul>
          {reach.kind === "loading" && <p className="mt-2 px-3 text-meta text-ink-3">Loading your repos…</p>}
          {reach.kind === "none" && <p className="mt-2 px-3 text-meta leading-normal text-ink-3">{reach.why}</p>}
          {reach.kind === "repos" && !found.length && !addable && (
            <p className="mt-2 px-3 text-meta text-ink-3">{q ? "None of your repos match." : "Your linked account reaches no repos through the App yet."}</p>
          )}
          {full && <p className="mt-2 px-3 text-meta text-ink-2">At most {MAX_REPOS} repos.</p>}

          <div className="mt-5 flex justify-end gap-2">
            {!same && (
              <Button variant="secondary" onClick={() => setDraft(repos)}>
                Undo
              </Button>
            )}
            <Button disabled={busy || same} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

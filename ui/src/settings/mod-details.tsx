import { lazy, Suspense, useEffect, useState } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"

import type { ModDetails, ModUpdate, ModView } from "../../../desktop/src/bridge.ts"
import { sizeText } from "~/chat/doc/bytes"
import { Icon } from "~/kit/icons"
import { runningMod, type RunningMod } from "~/mods/host"
import { ModIcon } from "~/mods/icon"
import { asksRooms, needWords, RoomPicker } from "~/mods/needs"
import { modReads } from "~/mods/served"
import { useApp, type Go } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { ModSettings } from "~/settings/mod-settings"

const Markdown = lazy(() => import("~/chat/markdown"))

const none = (): void => {}

const date = (at: number): string => new Date(at).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })

function useDetails(mod: ModView): ModDetails | null {
  const [got, setGot] = useState<{ key: string; details: ModDetails | null } | null>(null)
  const key = `${mod.name} ${mod.version ?? ""} ${mod.hash ?? ""} ${mod.icon ?? ""} ${mod.state} ${mod.settingsRev ?? ""}`
  useEffect(() => {
    const read = modReads().modDetails
    if (!read) return
    let live = true
    read(mod.name).then(
      (details) => live && setGot({ key, details }),
      () => live && setGot({ key, details: null })
    )
    return () => {
      live = false
    }
  }, [mod.name, key])
  return got?.details ?? null
}

const opening = (mod: ModView, run: RunningMod | undefined): Go | null => {
  if (mod.state !== "on" || !run || run.failed) return null
  if (run.tab?.shown) return { to: "tab", tab: `mod:${mod.name}` }
  if (run.title) return { to: "panel", panel: { kind: "mod", name: mod.name } }
  return run.side ? { to: "back" } : null
}

type Manage = { busy: boolean; update: ModUpdate | undefined; onUpdate: (() => void) | undefined; removeWhy: string; onRemove: () => void }

function ModRooms({ mod }: { mod: ModView }) {
  const { app, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const change = (next: NonNullable<ModView["rooms"]>) => {
    const b = bridge()
    if (!b || typeof b.setModRooms !== "function") return
    setBusy(true)
    b.setModRooms(mod.name, next).then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false)
        toast(e instanceof Error ? e.message : String(e), "error")
      }
    )
  }
  return (
    <Group title={`Where it may ${reachWords(mod.needs)}`} hint={busy ? "Saving…" : "It reaches only the channels you tick, and only these rooms."}>
      <div className="mod-details-rooms">
        <RoomPicker rooms={asksRooms(mod.needs)} channels={app.channels.filter((c) => c.state === "member")} value={mod.rooms ?? []} onChange={change} />
      </div>
    </Group>
  )
}

export function ModDetailsPage({ mod, manage }: { mod: ModView; manage?: Manage }) {
  const { app, nav, go, toast } = useApp()
  const open = modReads().openModFolder
  const openFolder = open
    ? () =>
        open(mod.name).then(
          (o) => toast(o.editor ? `Opened in ${o.editor}` : `Opened ${o.dir}`),
          (e: unknown) => toast(e instanceof Error ? e.message : String(e), "error")
        )
    : null
  const d = useDetails(mod)
  const run = runningMod(mod.name)
  const local = mod.source === "local"
  const opens = opening(mod, run)
  const into = nav.channel ?? app.channels.find((c) => c.state === "member")?.code ?? null
  const openMod =
    opens && into
      ? () => {
          go(nav.channel === into ? { to: "back" } : { to: "channel", code: into })
          go(opens)
        }
      : null
  const adds: (readonly [string, string])[] = [
    ...(run?.title ? [["Panel", run.title] as const] : []),
    ...(run?.side ? [["Sidebar section", run.side.title] as const] : []),
    ...(run?.commands ?? []).map((c) => ["Command in ⌘K", c] as const),
    ...(run?.actions ?? []).map((a) => ["In a message's menu", a.title] as const),
  ]
  return (
    <>
      <header className="set-head mod-head">
        <button type="button" className="btn is-quiet is-small mod-head-back" onClick={() => go({ to: "settings", section: "mods" })}>
          <Icon name="back" size={14} />
          Mods
        </button>
        <div className="mod-head-main">
          <ModIcon name={mod.name} icon={mod.icon} size="lg" />
          <div className="mod-head-text">
            <h2 className="set-title">{mod.name}</h2>
            <p className="set-lede">
              {mod.version && <span className="set-mono">{mod.version}</span>}
              {mod.version && d?.author && " · "}
              {d?.author && `by ${d.author}`}
            </p>
          </div>
          {openMod && (
            <div className="mod-head-act">
              <button type="button" className="btn is-primary is-small" onClick={openMod}>
                Open
              </button>
            </div>
          )}
        </div>
      </header>
      <Group hint={mod.state === "on" ? undefined : mod.why}>
        <Row label="Source" hint={local && openFolder ? "A folder on this computer" : undefined}>
          {local && openFolder ? (
            <button type="button" className="btn is-small" onClick={() => void openFolder()}>
              Open in editor
            </button>
          ) : (
            <span className="set-value">{local ? "A folder on this computer" : <span className="set-mono">{mod.source}</span>}</span>
          )}
        </Row>
        {d?.commit && (
          <Row label="Commit">
            <span className="set-value set-mono" title={d.commit}>
              {d.commit.slice(0, 7)}
            </span>
          </Row>
        )}
        {manage?.update && manage.onUpdate && (
          <Row label={`${manage.update.to} is out`} hint={`${manage.update.commits} new commit${manage.update.commits === 1 ? "" : "s"} from its source.`}>
            <button type="button" className="btn is-small" disabled={manage.busy} onClick={manage.onUpdate}>
              Update
            </button>
          </Row>
        )}
        {d?.installed !== null && d?.installed !== undefined && (
          <Row label="Installed">
            <span className="set-value set-mono">{date(d.installed)}</span>
          </Row>
        )}
        {d?.updated !== null && d?.updated !== undefined && (
          <Row label="Updated">
            <span className="set-value set-mono">{date(d.updated)}</span>
          </Row>
        )}
        {d?.bytes !== null && d?.bytes !== undefined && (
          <Row label="Size on disk">
            <span className="set-value set-mono">{sizeText(d.bytes)}</span>
          </Row>
        )}
        {d?.iconWhy && <Row label="Icon" hint={`It shows its first letter: ${d.iconWhy}.`} />}
      </Group>
      {d && d.settings.length > 0 && <ModSettings mod={mod.name} list={d.settings} />}
      <Group title="What it may do">
        {mod.needs.length ? (
          mod.needs.map((n) => <Row key={n} label={needWords(n)} hint={mod.approved.includes(n) ? undefined : "Waits for you to allow it"} />)
        ) : (
          <Row label="Nothing" hint="It asks for no permissions." />
        )}
      </Group>
      {mod.state !== "asks" && asksRooms(mod.needs).length > 0 && <ModRooms mod={mod} />}
      {adds.length > 0 && (
        <Group title="What it adds">
          {adds.map(([kind, title], i) => (
            <Row key={i} label={title} hint={kind} />
          ))}
        </Group>
      )}
      {d?.readme && (
        <Group title="README">
          <div className="mod-readme">
            <Suspense fallback={<p className="set-none">{d.readme}</p>}>
              <Markdown markdown={d.readme} onMention={none} onTask={none} onMessage={none} onImage={none} onShown={none} />
            </Suspense>
          </div>
        </Group>
      )}
      {manage && (
        <Group>
          <Row label={`Remove ${mod.name}`} hint={manage.removeWhy}>
            <button type="button" className="btn is-danger is-small" disabled={manage.busy} onClick={manage.onRemove}>
              Remove
            </button>
          </Row>
        </Group>
      )}
    </>
  )
}

const reachWords = (needs: readonly string[]): string => {
  const reads = needs.some((n) => n.startsWith("read:"))
  const posts = needs.some((n) => n.startsWith("post:"))
  return reads && posts ? "read and post" : reads ? "read" : "post"
}

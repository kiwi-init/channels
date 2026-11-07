import { lazy, Suspense, useCallback, useEffect, useState } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { ModInstalled, ModUpdate, ModView } from "../../../desktop/src/bridge.ts"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { askAgain, modsNow, useModsVersion } from "~/mods/host"
import { ModIcon } from "~/mods/icon"
import { asksRooms, needWords } from "~/mods/needs"
import { modReads } from "~/mods/served"
import { useApp } from "~/nav"
import { Confirm, Group, Row } from "~/settings/controls"
import { ModDetailsPage } from "~/settings/mod-details"
import { FromKiwi } from "~/settings/mods-catalog"
import { Page } from "~/settings/sections"

const ModStore = lazy(() => import("~/settings/mod-store"))

const wanted = (m: ModView): boolean => m.state === "on" || m.off === "safe"

const switchable = (m: ModView): boolean => m.state !== "off" || (m.off !== undefined && m.off !== "settings")

const managed = (): boolean => typeof modReads().modsInstalled === "function"

const onlyCopy = (i: ModInstalled | undefined): boolean => !!i && i.local && !i.link

function removeWhy(i: ModInstalled | undefined): string {
  if (i?.link) return `Only the link goes. Your folder ${i.link} stays.`
  if (onlyCopy(i)) return "This folder is its only copy, so it's gone for good."
  if (i?.changed) return "It has changes that aren't in its source, and they go with it."
  return "You can add it again from where it came from."
}

function Source({ m, i }: { m: ModView; i: ModInstalled | undefined }) {
  if (i?.link)
    return (
      <span className="set-note">
        Linked to <span className="set-mono">{i.link}</span>
      </span>
    )
  if (m.source === "local") return <span className="set-note">Local</span>
  return (
    <span className="set-note">
      From <span className="set-mono">{m.source}</span>
      {i?.commit && <span className="set-mono"> · {i.commit}</span>}
    </span>
  )
}

type Asking = { kind: "update"; m: ModView; u: ModUpdate } | { kind: "remove"; m: ModView; i: ModInstalled | undefined }

export function ModsSection() {
  useModsVersion()
  const { nav, go, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Map<string, ModInstalled>>(new Map())
  const [updates, setUpdates] = useState<Map<string, ModUpdate>>(new Map())
  const [asking, setAsking] = useState<Asking | null>(null)
  const mods = modsNow()
  const open = nav.mod ? mods.find((m) => m.name === nav.mod) : undefined
  const names = mods.map((m) => `${m.name}@${m.version ?? ""}`).join(" ")

  const fail = useCallback(
    (e: unknown) => {
      setBusy(null)
      toast(e instanceof Error ? e.message : String(e), "error")
    },
    [toast]
  )

  useEffect(() => {
    const read = modReads().modsInstalled
    if (!names || !read) return
    let live = true
    void read().then(
      (list) => live && setInstalled(new Map(list.map((i) => [i.name, i]))),
      () => {}
    )
    return () => {
      live = false
    }
  }, [names])

  useEffect(() => {
    const read = modReads().modUpdates
    if (!read) return
    let live = true
    void read().then(
      (found) => live && setUpdates(new Map(found.changes.map((c) => [c.name, c]))),
      () => {}
    )
    return () => {
      live = false
    }
  }, [])

  const flip = (m: ModView, on: boolean) => {
    const b = bridge()
    if (!b || typeof b.setModOn !== "function") return
    if (on && m.state === "asks" && asksRooms(m.needs).length) return askAgain(m.name)
    setBusy(m.name)
    const done = on && m.state === "asks" ? b.approveMod(m.name, m.needs) : b.setModOn(m.name, on)
    done.then(() => setBusy(null), fail)
  }
  const update = (m: ModView) => {
    const run = modReads().updateMod
    if (!run) return
    setAsking(null)
    setBusy(m.name)
    run(m.name).then(() => {
      setBusy(null)
      setUpdates((now) => {
        const next = new Map(now)
        next.delete(m.name)
        return next
      })
    }, fail)
  }

  const remove = (m: ModView, i: ModInstalled | undefined) => {
    const run = modReads().removeMod
    if (!run) return
    setAsking(null)
    setBusy(m.name)
    run(m.name, !!i?.changed || onlyCopy(i)).then(() => {
      setBusy(null)
      go({ to: "settings", section: "mods" })
    }, fail)
  }

  const askUpdate = (m: ModView, u: ModUpdate) => (u.added.length || u.dropped.length ? setAsking({ kind: "update", m, u }) : update(m))

  const confirms = (
    <>
      <Confirm
        open={asking?.kind === "update"}
        title={asking?.kind === "update" ? `Update ${asking.m.name} to ${asking.u.to}?` : ""}
        sub={asking?.kind === "update" ? `${asking.u.commits} new commit${asking.u.commits === 1 ? "" : "s"} from its source.` : ""}
        action="Update"
        tone="primary"
        onClose={() => setAsking(null)}
        onConfirm={() => asking?.kind === "update" && update(asking.m)}
      >
        {asking?.kind === "update" && (
          <>
            {asking.u.added.length > 0 && <p className="set-note">It now also asks for: {asking.u.added.map(needWords).join(" · ")}. It waits for you to allow that before it runs again.</p>}
            {asking.u.dropped.length > 0 && <p className="set-note">It no longer asks for: {asking.u.dropped.map(needWords).join(" · ")}.</p>}
          </>
        )}
      </Confirm>
      <Confirm
        open={asking?.kind === "remove"}
        title={asking?.kind === "remove" ? `Remove ${asking.m.name}?` : ""}
        sub={asking?.kind === "remove" ? removeWhy(asking.i) : ""}
        action="Remove"
        onClose={() => setAsking(null)}
        onConfirm={() => asking?.kind === "remove" && remove(asking.m, asking.i)}
      />
    </>
  )

  if (open) {
    const u = updates.get(open.name)
    const i = installed.get(open.name)
    return (
      <>
        <ModDetailsPage
          mod={open}
          manage={
            managed()
              ? { busy: busy === open.name, update: u, onUpdate: u ? () => askUpdate(open, u) : undefined, removeWhy: removeWhy(i), onRemove: () => setAsking({ kind: "remove", m: open, i }) }
              : undefined
          }
        />
        {confirms}
      </>
    )
  }
  if (nav.mod)
    return (
      <Suspense fallback={null}>
        <ModStore name={nav.mod} />
      </Suspense>
    )
  return (
    <Page title="Mods" lede="Each one runs in its own frame, away from your keys and messages.">
      {mods.some((m) => m.state === "asks") && (
        <Group title="Waiting for you">
          {mods
            .filter((m) => m.state === "asks")
            .map((m) => (
              <Row key={m.name} label={`${m.name} asks to run`} hint={m.needs.map(needWords).join(" · ")}>
                <button type="button" className="btn is-primary is-small" onClick={() => askAgain(m.name)}>
                  Review
                </button>
              </Row>
            ))}
        </Group>
      )}
      <Group hint={mods.find((m) => m.off === "safe")?.why}>
        {mods.length ? (
          mods.map((m) => (
            <div key={m.name} className="set-row mod-row">
              <button type="button" className="mod-open" onClick={() => go({ to: "settings", section: "mods", mod: m.name })}>
                <ModIcon name={m.name} icon={m.icon} />
                <span className="set-row-text">
                  <span className="set-row-label">{m.version ? `${m.name} ${m.version}` : m.name}</span>
                  <span className="set-row-hint">
                    <Source m={m} i={installed.get(m.name)} />
                    {m.needs.length > 0 && <span className="set-note">{m.needs.map(needWords).join(" · ")}</span>}
                    {m.why && m.off !== "safe" && m.off !== "you" && <span className="set-note">{m.why}</span>}
                    {installed.get(m.name)?.changed && <span className="set-note">It has changes that aren't in its source.</span>}
                  </span>
                </span>
                <span className="mod-open-more">
                  <Icon name="chevron" size={14} />
                </span>
              </button>
              <div className="set-row-ctl">
                {updates.get(m.name) && (
                  <button type="button" className="btn is-quiet is-small" disabled={busy === m.name} onClick={() => askUpdate(m, updates.get(m.name)!)}>
                    Update to {updates.get(m.name)!.to}
                  </button>
                )}
                {switchable(m) && <Toggle on={wanted(m)} label={`Run ${m.name}`} disabled={busy === m.name} onChange={(on) => flip(m, on)} />}
              </div>
            </div>
          ))
        ) : (
          <Row
            label="No mods yet"
            hint={
              <>
                Add one with <span className="set-mono">kiwi mod add</span>.
              </>
            }
          />
        )}
      </Group>
      <FromKiwi installed={new Set(mods.map((m) => m.name))} />
      {confirms}
    </Page>
  )
}

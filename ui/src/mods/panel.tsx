import "~/styles/mods.css"

import { useCallback, useState } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { ModSnippet, ModView } from "../../../desktop/src/bridge.ts"
import { Empty } from "~/kit/empty"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"
import { modsNow, runningMod, showModIn, useModsVersion } from "~/mods/host"
import { needWords } from "~/mods/needs"

export function ModPanel({ name }: { name: string }) {
  useModsVersion()
  const mod = modsNow().find((m) => m.name === name)
  const run = runningMod(name)
  const slot = useCallback(
    (el: HTMLDivElement | null) => {
      showModIn(name, el)
      return () => showModIn(name, null)
    },
    [name]
  )
  if (!mod)
    return (
      <>
        <PanelHead title={name} />
        <Empty title="This mod is gone." />
      </>
    )
  if (mod.state === "asks") return <Ask name={name} version={mod.version} needs={mod.needs} terminal={mod.terminal} />
  if (mod.state === "off" || run?.failed)
    return (
      <>
        <PanelHead title={name} sub="mod" />
        <Empty title={mod.state === "off" ? "This mod is off." : "This mod stopped."}>
          <p className="mod-why">{mod.why ?? run?.failed}</p>
        </Empty>
      </>
    )
  return (
    <>
      <PanelHead title={run?.title ?? name} sub="mod" />
      <div ref={slot} className="panel-body mod-slot" />
    </>
  )
}

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

function Ask({ name, version, needs, terminal }: { name: string; version: string | null; needs: string[]; terminal: ModView["terminal"] }) {
  const { go, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const approve = () => {
    const b = bridge()
    if (!b) return
    setBusy(true)
    b.approveMod(name, needs).then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false)
        toast(e instanceof Error ? e.message : String(e), "error")
      }
    )
  }
  return (
    <>
      <PanelHead title={name} sub={version ? `mod ${version}` : "mod"} />
      <div className="panel-body mod-ask">
        <p>It runs in its own frame, away from your keys and messages. To work, it asks for:</p>
        <ul className="mod-needs">
          {needs.map((n) => (
            <li key={n}>{needWords(n)}</li>
          ))}
        </ul>
        {terminal?.tmux && <Snippet snippet={terminal.tmux} into=" for tmux" />}
        {terminal?.rex && <Snippet snippet={terminal.rex} into=" for Rex" />}
        {terminal && <p>Removing the mod takes these lines back out.</p>}
        <div className="mod-ask-actions">
          <button type="button" className="btn is-primary" disabled={busy} onClick={approve}>
            Turn on
          </button>
          <button type="button" className="btn is-quiet" onClick={() => go({ to: "panel", panel: null })}>
            Not now
          </button>
        </div>
      </div>
    </>
  )
}

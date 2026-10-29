import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import type { ComputerSettings, SeatWake } from "@kiwi/core/computer-settings.ts"
import type { HookState } from "@kiwi/core/harnesses.ts"
import { harnessName } from "@/lib/harness"
import { settingsBridge } from "@/lib/launches"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Spinner, errorText } from "./kit"

type Got = { ok: true; value: ComputerSettings } | { ok: false; detail: string }

const HOOK: Record<Exclude<HookState, "absent">, string> = { installed: "on", partial: "partly on", outdated: "out of date", missing: "not installed", off: "off" }
const WAKE: Record<SeatWake, string> = { on: "wakes on a message", off: "doesn't wake", webhook: "wakes by webhook" }

export function settingsLines(s: ComputerSettings): [string, string[]][] {
  const hooks = s.hooks.flatMap((h) => (h.state === "absent" ? [] : [`${harnessName(h.harness)} ${HOOK[h.state]}`]))
  return [
    ["New agents", [s.launch === "on" ? "Allowed" : "Off"]],
    ["Bypass from your other devices", [s.bypass === "on" ? "Allowed" : "Off"]],
    ["Hooks", hooks.length ? hooks : ["None"]],
    ["Agents", s.seats.length ? s.seats.map((seat) => `${seat.agent} in ${seat.channel}, ${WAKE[seat.wake]}`) : ["None yet"]],
  ]
}

export function RemoteSettings({ machinePk, label }: { machinePk: string; label: string }) {
  const b = settingsBridge()
  const [open, setOpen] = useState(false)
  const [got, setGot] = useState<Got | null>(null)
  if (!b) return null
  const load = () => {
    setGot(null)
    void b.settingsOn(machinePk).then(setGot, (err: unknown) => setGot({ ok: false, detail: errorText(err) }))
  }
  return (
    <div className="pb-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open && !got) load()
          setOpen((o) => !o)
        }}
        className="flex items-center gap-1 rounded-row text-meta text-ink-3 transition-colors hover:text-ink"
      >
        <Icon icon={ArrowDown01Icon} size={12} className={cx("shrink-0", !open && "-rotate-90")} />
        Its settings
      </button>
      {open &&
        (got === null ? (
          <p className="mt-1.5 flex items-center gap-2 text-meta text-ink-3">
            <Spinner />
            Asking {label}…
          </p>
        ) : !got.ok ? (
          <p className="mt-1.5 text-meta text-ink-2">
            {got.detail}{" "}
            <button type="button" onClick={load} className="font-medium text-ink underline-offset-2 hover:underline">
              Try again
            </button>
          </p>
        ) : (
          <div className="mt-1.5 rounded-ctl bg-wash px-3 py-2.5">
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta">
              {settingsLines(got.value).map(([term, lines]) => (
                <div key={term} className="contents">
                  <dt className="text-ink-3">{term}</dt>
                  <dd className="min-w-0 text-ink-2">
                    {lines.map((line) => (
                      <p key={line} className="truncate">
                        {line}
                      </p>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="pt-2 text-meta text-ink-3">Read only. Change these on {label}.</p>
          </div>
        ))}
    </div>
  )
}

import "~/styles/blueprint.css"

import { useEffect, useRef, useState } from "react"

import { audit, type Issue } from "~/kit/blueprint-audit"
import { toggleBlueprint } from "~/kit/blueprint-on"
import { copyText } from "~/kit/toasts"

interface Check {
  name: string
  off: number
}

interface Probe {
  left: number
  top: number
  width: number
  height: number
}

interface Picked extends Probe {
  id: string
}

interface Plan {
  width: number
  height: number
  columns: number[]
  rows: number[]
  checks: Check[]
  notes: string[]
  issues: Issue[]
}

const COLUMNS: readonly (readonly [string, "left" | "right" | "both"])[] = [
  [".side", "right"],
  [".set-nav", "right"],
  [".main .composer", "both"],
  [".board-list", "both"],
  [".calm", "both"],
  [".set-body", "both"],
  ["aside.panel", "left"],
  [".track", "left"],
]
const ROWS: readonly (readonly [string, "top" | "bottom" | "both"])[] = [
  [".top", "bottom"],
  [".main .composer", "both"],
]
const CENTRED = [".top-here", ".chan:not(.is-bare):not(.has-panel) .main .composer", ".calm"]
const MIN_SPAN = 28
const NEAR = 4
const RULER = 2
const PICK_MS = 1400
const QUIET_MS = 600
const GROUP_CAP = 40
const PARTS: readonly string[] = [
  ".rail",
  ".tile.is-home",
  ".rail-gear",
  ".top",
  ".top-drawer",
  ".top-here",
  ".side-chan",
  ".top-tools .icon-btn:last-child",
  ".side",
  ".side-row.is-on",
  ".main",
  ".feed-list",
  ".main .composer",
  ".main .send",
  ".track",
  ".track-head",
  ".track-bar",
  ".track-next",
  "aside.panel",
  "aside.panel .panel-head",
  "aside.panel .panel-title",
  "aside.panel .panel-body",
  ".board-list",
  ".now",
  ".lanes",
  ".needs-list",
  ".calm",
  ".set-nav",
  ".set-body",
]
const GROUPS: readonly (readonly [string, "x" | "y"])[] = [
  [".rail .tile", "x"],
  [".side section", "y"],
  [".side .heading", "y"],
  [".side .side-row", "y"],
  [".track .side-row", "y"],
  [".feed-list > .msg", "y"],
  [".lane", "x"],
  [".needs-card", "y"],
]
const TEXT_EDGES: readonly string[] = [".side .heading h3", ".side .side-label, .side .side-name", ".track .side-label", ".msg:not(.is-mine) .msg-text", ".msg .msg-name"]

const boxOf = (selector: string): DOMRect | null => {
  const box = document.querySelector(selector)?.getBoundingClientRect()
  return box && box.width > 0 && box.height > 0 ? box : null
}

const half = (n: number): number => Math.round(n * 2) / 2

const GRID = 8
const onGrid = (n: number): boolean => Math.abs(n / GRID - Math.round(n / GRID)) * GRID <= 0.25
const FLOWS = /feed|msg|calm|set-body|board|lanes|needs|track-next|panel-body/
const SIZED = /top-here|side-chan|panel-title|feed|msg|\.main$/

function measure(): Plan {
  const width = window.innerWidth
  const height = window.innerHeight
  const columns = new Set<number>()
  for (const [selector, side] of COLUMNS) {
    const box = boxOf(selector)
    if (!box) continue
    if (side !== "right") columns.add(half(box.left))
    if (side !== "left") columns.add(half(box.right))
  }
  const rows = new Set<number>()
  for (const [selector, side] of ROWS) {
    const box = boxOf(selector)
    if (!box) continue
    if (side !== "bottom") rows.add(half(box.top))
    if (side !== "top") rows.add(half(box.bottom))
  }
  const checks = CENTRED.flatMap((name) => {
    const box = boxOf(name)
    return box ? [{ name: name.split(" ").pop() ?? name, off: Math.round(((box.left + box.right) / 2 - width / 2) * 10) / 10 }] : []
  })
  const inside = (edge: number, end: number): boolean => edge > 0.5 && edge < end - 0.5
  const at = (box: DOMRect, selector: string): string => {
    const flows = FLOWS.test(selector)
    const right = width - box.right
    const bottom = height - box.bottom
    const centred = Math.abs(box.left - right) <= 1
    const off = [
      centred || onGrid(box.left) || onGrid(right) ? "" : "x",
      flows || onGrid(box.top) || onGrid(bottom) ? "" : "y",
      SIZED.test(selector) || onGrid(box.width) || (onGrid(box.left) && onGrid(right)) ? "" : "w",
      flows || SIZED.test(selector) || box.height <= 4 || onGrid(box.height) || (onGrid(box.top) && onGrid(bottom)) ? "" : "h",
    ].filter(Boolean)
    return `x ${half(box.left)} y ${half(box.top)} w ${half(box.width)} h ${half(box.height)} right ${half(right)} bottom ${half(bottom)} ${off.length ? `off grid ${off.join(" ")}` : "on grid"}`
  }
  const notes = [`bp: window w ${width} h ${height} centre ${width / 2}`]
  for (const [selector, side] of COLUMNS) {
    const box = boxOf(selector)
    if (!box) continue
    if (side !== "right") notes.push(`bp: line v x ${half(box.left)} of ${selector} left`)
    if (side !== "left") notes.push(`bp: line v x ${half(box.right)} of ${selector} right`)
  }
  for (const [selector, side] of ROWS) {
    const box = boxOf(selector)
    if (!box) continue
    if (side !== "bottom") notes.push(`bp: line h y ${half(box.top)} of ${selector} top`)
    if (side !== "top") notes.push(`bp: line h y ${half(box.bottom)} of ${selector} bottom`)
  }
  const sorted = [0, ...[...columns].filter((x) => inside(x, width)).sort((a, b) => a - b), width]
  sorted.slice(1).forEach((to, i) => notes.push(`bp: span x ${sorted[i]} to ${to} w ${half(to - (sorted[i] ?? 0))}`))
  for (const c of checks) notes.push(`bp: centre ${c.name} off ${c.off}`)
  for (const selector of PARTS) {
    const box = boxOf(selector)
    if (box) notes.push(`bp: part ${selector} ${at(box, selector)}`)
  }
  for (const [selector, axis] of GROUPS) {
    const boxes = [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0)
    boxes.slice(0, GROUP_CAP).forEach((box, i) => {
      const before = boxes[i - 1]
      const gap = before ? half(axis === "y" ? box.top - before.bottom : box.left - before.right) : 0
      notes.push(`bp: item ${selector} ${i + 1} of ${boxes.length} ${at(box, selector)} gap ${gap}${onGrid(gap) ? "" : " gap off grid"}`)
    })
  }
  for (const selector of TEXT_EDGES) {
    const edges = new Set<number>()
    for (const el of document.querySelectorAll(selector)) {
      const range = document.createRange()
      range.selectNodeContents(el)
      const box = range.getBoundingClientRect()
      if (box.width > 0) edges.add(half(box.left))
    }
    if (edges.size) notes.push(`bp: text ${selector} starts at x ${[...edges].sort((a, b) => a - b).join(" ")}`)
  }
  const issues = audit(width, height, sorted.slice(1, -1))
  notes.push(`bp: audit ${issues.length} issue${issues.length === 1 ? "" : "s"}${issues.length ? `: ${[...new Set(issues.map((issue) => issue.kind))].join(", ")}` : ""}`)
  for (const issue of issues) notes.push(`bp: issue ${issue.kind}: ${issue.text} (x ${issue.left} y ${issue.top} w ${issue.width} h ${issue.height})`)
  return {
    notes,
    issues,
    width,
    height,
    columns: [...columns].filter((x) => inside(x, width)).sort((a, b) => a - b),
    rows: [...rows].filter((y) => inside(y, height)).sort((a, b) => a - b),
    checks,
  }
}

const MARKS = ["data-seq", "data-code", "data-folder", "aria-label", "title"]

function idOf(el: Element): string {
  const classes = [...el.classList].join(".")
  const trail: string[] = []
  for (let at = el.parentElement; at && at !== document.body && trail.length < 3; at = at.parentElement) {
    const first = at.classList[0]
    if (first) trail.unshift(`.${first}`)
  }
  const marks = MARKS.flatMap((name) => {
    const value = el.getAttribute(name)
    return value ? [`[${name}="${value.slice(0, 40)}"]`] : []
  })
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48)
  const box = el.getBoundingClientRect()
  return [
    `bp: pick ${classes ? `.${classes}` : el.tagName.toLowerCase()}`,
    trail.length ? `in ${trail.join(" > ")}` : "",
    ...marks,
    text ? `"${text}"` : "",
    `x ${half(box.left)} y ${half(box.top)} w ${half(box.width)} h ${half(box.height)}`,
  ]
    .filter(Boolean)
    .join(" ")
}

export function Blueprint({ drawn }: { drawn: boolean }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const shown = useRef(drawn)
  useEffect(() => {
    shown.current = drawn
  }, [drawn])
  useEffect(() => {
    let last = ""
    let current: Plan | null = null
    const read = () => {
      const next = measure()
      const key = JSON.stringify(next)
      if (key === last) return
      last = key
      current = next
      setPlan(next)
    }
    read()
    let quiet = 0
    const soon = () => {
      window.clearTimeout(quiet)
      quiet = window.setTimeout(read, QUIET_MS)
    }
    const watch = new MutationObserver((changes) => {
      if (changes.some((change) => !(change.target instanceof Element && change.target.closest(".bp")))) soon()
    })
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style", "aria-pressed", "aria-current"] })
    window.addEventListener("resize", soon)
    window.addEventListener("scroll", soon, true)
    let frame = 0
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = document.elementFromPoint(e.clientX, e.clientY)?.getBoundingClientRect()
        setProbe(box && box.width < window.innerWidth - 1 ? { left: half(box.left), top: half(box.top), width: half(box.width), height: half(box.height) } : null)
      })
    }
    const onLeave = () => setProbe(null)
    let held: Element | null = null
    let clear = 0
    const show = (next: Picked) => {
      setPicked(next)
      copyText(next.id)
      window.clearTimeout(clear)
      clear = window.setTimeout(() => setPicked(null), PICK_MS)
    }
    const drawn = (x: number, y: number): Picked | null => {
      if (!current) return null
      const edges = [0, ...current.columns, current.width]
      const ruler = RULER
      if (y >= ruler - 4 && y <= ruler + 16) {
        const i = edges.findIndex((edge, at) => at > 0 && x <= edge)
        const from = edges[i - 1]
        const to = edges[i]
        if (from !== undefined && to !== undefined) return { id: `bp: pick blueprint ruler span x ${from} to ${to} w ${half(to - from)}`, left: from, top: ruler, width: to - from, height: 12 }
      }
      const column = current.columns.find((edge) => Math.abs(edge - x) <= NEAR)
      if (column !== undefined) {
        const note = current.notes.find((line) => line.startsWith(`bp: line v x ${column} `))
        return { id: `bp: pick blueprint ${note ? note.slice(4) : `line v x ${column}`}`, left: column - 1, top: 0, width: 2, height: current.height }
      }
      if (Math.abs(current.width / 2 - x) <= NEAR) return { id: `bp: pick blueprint centre line x ${current.width / 2}`, left: current.width / 2 - 1, top: 0, width: 2, height: current.height }
      return null
    }
    const space = (x: number, under: Element): Picked | null => {
      if (!current) return null
      const edges = [0, ...current.columns, current.width]
      const i = edges.findIndex((edge, at) => at > 0 && x <= edge)
      const from = edges[i - 1]
      const to = edges[i]
      const box = under.getBoundingClientRect()
      if (from === undefined || to === undefined || box.left > from + 1 || box.right < to - 1 || box.height < current.height / 2) return null
      const side = (edge: number): string => {
        const note = current?.notes.find((line) => line.startsWith(`bp: line v x ${edge} `))
        return note ? note.slice(note.indexOf(" of ") + 4) : edge === 0 ? "the window's left edge" : "the window's right edge"
      }
      const first = under.classList[0]
      return {
        id: `bp: pick blueprint space x ${from} to ${to} w ${half(to - from)} between ${side(from)} and ${side(to)}, inside ${first ? `.${first}` : under.tagName.toLowerCase()}`,
        left: from,
        top: 0,
        width: to - from,
        height: current.height,
      }
    }
    const onPick = (e: MouseEvent) => {
      if (!e.altKey || !shown.current) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.type !== "click") return
      const line = e.shiftKey ? null : drawn(e.clientX, e.clientY)
      if (line) return show(line)
      const under = document.elementFromPoint(e.clientX, e.clientY)
      const gap = under && !e.shiftKey ? space(e.clientX, under) : null
      if (gap) return show(gap)
      const el = e.shiftKey && held?.parentElement && under && held.contains(under) ? held.parentElement : under
      if (!el) return
      held = el
      const box = el.getBoundingClientRect()
      show({ id: idOf(el), left: half(box.left), top: half(box.top), width: half(box.width), height: half(box.height) })
    }
    window.addEventListener("mousedown", onPick, true)
    window.addEventListener("mouseup", onPick, true)
    window.addEventListener("click", onPick, true)
    window.addEventListener("mousemove", onMove)
    document.documentElement.addEventListener("mouseleave", onLeave)
    return () => {
      window.clearTimeout(quiet)
      watch.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", soon)
      window.removeEventListener("scroll", soon, true)
      window.clearTimeout(clear)
      window.removeEventListener("mousedown", onPick, true)
      window.removeEventListener("mouseup", onPick, true)
      window.removeEventListener("click", onPick, true)
      window.removeEventListener("mousemove", onMove)
      document.documentElement.removeEventListener("mouseleave", onLeave)
    }
  }, [])
  if (!plan) return null
  const edges = [0, ...plan.columns, plan.width]
  const ruler = RULER
  const chips = (plan.rows[0] ?? 0) + 16
  return (
    <div className="bp">
      <button type="button" className="bp-do" aria-label="bp: do toggle lines" onClick={toggleBlueprint} />
      <div className="bp-notes" role="group" aria-label="bp: blueprint">
        {plan.notes.map((note) => (
          <span key={note} className="bp-note" role="img" aria-label={note} />
        ))}
        {probe && <span className="bp-note" role="img" aria-label={`bp: pointer over x ${probe.left} y ${probe.top} w ${probe.width} h ${probe.height}`} />}
        {picked && <span className="bp-note" role="img" aria-label={picked.id} />}
      </div>
      <div className="bp-lines" aria-hidden="true" hidden={!drawn}>
        <div className="bp-grid" />
        {plan.columns.map((x) => (
          <span key={`v${x}`} className="bp-v" style={{ left: x }} />
        ))}
        <span className="bp-v is-centre" style={{ left: plan.width / 2 }} />
        {edges.slice(1).map((to, i) => {
          const from = edges[i] ?? 0
          return to - from >= MIN_SPAN ? (
            <span key={`s${from}`} className="bp-span" style={{ left: from, width: to - from, top: ruler }}>
              <span className={onGrid(to - from) ? "bp-n" : "bp-n is-off"}>{half(to - from)}</span>
            </span>
          ) : null
        })}
        <div className="bp-checks" style={{ top: chips }}>
          <span className={plan.issues.length ? "bp-check is-off" : "bp-check is-ok"}>
            {plan.issues.length} issue{plan.issues.length === 1 ? "" : "s"}
          </span>
          {plan.checks.map((c) => (
            <span key={c.name} className={Math.abs(c.off) <= 1 ? "bp-check is-ok" : "bp-check is-off"}>
              {c.name} {c.off > 0 ? "+" : ""}
              {c.off}
            </span>
          ))}
        </div>
        {plan.issues.map((issue) => (
          <span key={`${issue.kind}${issue.text}`} className="bp-issue" title={issue.text} style={{ left: issue.left, top: issue.top, width: issue.width, height: issue.height }} />
        ))}
        {picked && (
          <span className="bp-probe is-picked" style={{ left: picked.left, top: picked.top, width: picked.width, height: picked.height }}>
            <span className={picked.top < 24 ? "bp-probe-n is-under" : "bp-probe-n"}>{picked.id.slice(4)}</span>
          </span>
        )}
        {probe && (
          <span className="bp-probe" style={{ left: probe.left, top: probe.top, width: probe.width, height: probe.height }}>
            <span className={probe.top < 24 ? "bp-probe-n is-under" : "bp-probe-n"}>
              {probe.width} × {probe.height} · {probe.left}, {probe.top}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

export interface Issue {
  kind: "covered" | "small" | "cut" | "outside" | "near" | "height" | "stray" | "sideways"
  text: string
  left: number
  top: number
  width: number
  height: number
}

const ACTS = "button, a[href], input, textarea, select, [role='button']"
const TEXTS = "h1, h2, h3, button, a, span, p, li, dt, dd, time, label"
const GRID = 8
const MIN_TARGET = 24
const CUT_SHOWN = 48
const NEAR = 2
const MOST = 40
const TALLEST = 44
const STRAY = 12
const COMMON = 3
const STRIPS = ".seg, .rail"
const PROSE = ".md, .msg-text, pre, table, .doc, .bp"

const half = (n: number): number => Math.round(n * 2) / 2

function nameOf(el: Element): string {
  const classes = [...el.classList].slice(0, 2).join(".")
  const said = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 32)
  return `${classes ? `.${classes}` : el.tagName.toLowerCase()}${said ? ` "${said}"` : ""}`
}

function seen(el: Element, width: number, height: number): DOMRect | null {
  if (el.closest(".bp")) return null
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.top >= height || box.right <= 0 || box.left >= width) return null
  const style = getComputedStyle(el)
  if (style.visibility === "hidden" || style.opacity === "0") return null
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
    if (getComputedStyle(up).overflow === "visible") continue
    const clip = up.getBoundingClientRect()
    if (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom) return null
  }
  return box
}

function scroller(el: Element): Element | null {
  for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
    const flow = getComputedStyle(up).overflowY
    if (flow === "auto" || flow === "scroll") return up
  }
  return null
}

function filled(el: Element): boolean {
  const style = getComputedStyle(el)
  return style.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(style.borderTopWidth) > 0 || style.boxShadow !== "none"
}

function plain(el: Element): boolean {
  const style = getComputedStyle(el)
  const bare = style.backgroundColor === "rgba(0, 0, 0, 0)" && parseFloat(style.borderTopWidth) === 0
  return bare && (el.tagName === "INPUT" || parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) === 0)
}

const at = (kind: Issue["kind"], text: string, box: DOMRect): Issue => ({ kind, text, left: half(box.left), top: half(box.top), width: half(box.width), height: half(box.height) })

export function audit(width: number, height: number, columns: readonly number[]): Issue[] {
  const issues: Issue[] = []
  const heights = new Map<string, { n: number; box: DOMRect }>()
  const lefts: { x: number; box: DOMRect; name: string }[] = []
  for (const el of document.querySelectorAll<HTMLElement>(ACTS)) {
    const box = seen(el, width, height)
    if (!box) continue
    const name = nameOf(el)
    const x = Math.min(width - 1, Math.max(0, box.left + box.width / 2))
    const y = Math.min(height - 1, Math.max(0, box.top + box.height / 2))
    const top = document.elementFromPoint(x, y)
    const stranger = top && top !== el && !el.contains(top) && !top.contains(el) ? top : null
    const pane = scroller(el)
    const over = stranger && !(pane && !pane.contains(stranger)) ? (stranger.closest(ACTS) ?? (pane ? null : stranger)) : null
    const modal = over?.closest("dialog, [role='dialog'], [aria-modal='true'], .palette, .rail-menu")
    if (over && over !== el && !over.contains(el) && !el.contains(over) && (!modal || modal.contains(el))) issues.push(at("covered", `${name} is under ${nameOf(over)}`, box))
    if (box.left < -0.5 || box.right > width + 0.5) issues.push(at("outside", `${name} runs outside the window`, box))
    const inline = getComputedStyle(el).display === "inline"
    if (!inline && box.width < MIN_TARGET - 0.5 && box.height < MIN_TARGET - 0.5) issues.push(at("small", `${name} is ${half(box.width)}×${half(box.height)}, under ${MIN_TARGET}px`, box))
    if (!inline && el.tagName !== "TEXTAREA" && box.height <= TALLEST && !plain(el) && Math.abs(box.height / GRID - Math.round(box.height / GRID)) * GRID > 0.25) {
      const key = `${el.classList[0] ?? el.tagName.toLowerCase()} ${half(box.height)}`
      const had = heights.get(key)
      heights.set(key, { n: (had?.n ?? 0) + 1, box: had?.box ?? box })
    }
    lefts.push({ x: half(box.left), box, name })
  }
  for (const [key, { n, box }] of heights) {
    const [cls, h] = key.split(" ")
    issues.push(at("height", `.${cls} is ${h}px high, off the ${GRID}px grid${n > 1 ? ` (${n} of them)` : ""}`, box))
  }
  for (const el of document.querySelectorAll<HTMLElement>(TEXTS)) {
    if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth >= CUT_SHOWN || !el.clientWidth) continue
    const box = seen(el, width, height)
    if (!box || getComputedStyle(el).textOverflow !== "ellipsis") continue
    issues.push(at("cut", `${nameOf(el)} shows ${el.clientWidth}px of its ${el.scrollWidth}px`, box))
  }
  const edges = [0, ...columns, width]
  for (let i = 1; i < edges.length; i++) {
    const from = edges[i - 1] ?? 0
    const to = edges[i] ?? width
    const counts = new Map<number, { n: number; box: DOMRect; name: string }>()
    for (const l of lefts) {
      if (l.x < from || l.x >= to) continue
      const had = counts.get(l.x)
      counts.set(l.x, { n: (had?.n ?? 0) + 1, box: had?.box ?? l.box, name: had?.name ?? l.name })
    }
    const xs = [...counts.keys()].sort((a, b) => a - b)
    for (let k = 1; k < xs.length; k++) {
      const a = xs[k - 1] ?? 0
      const b = xs[k] ?? 0
      const one = counts.get(a)
      const two = counts.get(b)
      if (!one || !two || b - a > NEAR || b - a < 1 || Math.max(one.n, two.n) < 3) continue
      const odd = one.n <= two.n ? one : two
      const right = half(odd.box.right)
      if (lefts.some((l) => l.box !== odd.box && half(l.box.right) === right)) continue
      issues.push(at("near", `${odd.name} starts at x ${one.n <= two.n ? a : b}, ${half(b - a)}px off ${one.n <= two.n ? two.n : one.n} others at x ${one.n <= two.n ? b : a}`, odd.box))
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>("main, aside, nav, section, header, ul, ol, div, pre, code, table, figure")) {
    if (el.scrollWidth <= el.clientWidth + 1 || el.closest(".bp, .annot-stage")) continue
    const flow = getComputedStyle(el).overflowX
    if (flow !== "auto" && flow !== "scroll") continue
    const box = seen(el, width, height)
    if (box) issues.push(at("sideways", `${nameOf(el).split(' "')[0]} scrolls sideways by ${el.scrollWidth - el.clientWidth}px`, box))
  }
  const starts: { x: number; box: DOMRect; name: string }[] = []
  for (const el of document.querySelectorAll<HTMLElement>(TEXTS)) {
    const first = el.firstChild
    if (first?.nodeType !== Node.TEXT_NODE || !first.textContent?.trim() || el.closest(PROSE) || el.closest(STRIPS) || el.previousElementSibling) continue
    if (!seen(el, width, height)) continue
    const held = el.closest(`${ACTS}, .av, .chip, .count`)
    if (held && filled(held)) {
      const box = held.getBoundingClientRect()
      if (!starts.some((s) => s.box.left === box.left && s.box.top === box.top)) starts.push({ x: half(box.left), box, name: nameOf(held) })
      continue
    }
    const range = document.createRange()
    range.selectNodeContents(first)
    const box = range.getBoundingClientRect()
    if (box.width > 0) starts.push({ x: half(box.left), box, name: nameOf(el) })
  }
  for (let i = 1; i < edges.length; i++) {
    const from = edges[i - 1] ?? 0
    const to = edges[i] ?? width
    const here = starts.filter((s) => s.x >= from && s.x < to && s.x < (from + to) / 2)
    const counts = new Map<number, number>()
    for (const s of here) counts.set(s.x, (counts.get(s.x) ?? 0) + 1)
    for (const s of here) {
      if ((counts.get(s.x) ?? 0) > 1) continue
      const near = [...counts].filter(([x, n]) => n >= COMMON && Math.abs(x - s.x) > 0.5 && Math.abs(x - s.x) <= STRAY).sort((a, b) => Math.abs(a[0] - s.x) - Math.abs(b[0] - s.x))[0]
      if (near) issues.push(at("stray", `${s.name} starts alone at x ${s.x}, ${half(Math.abs(near[0] - s.x))}px from ${near[1]} others at x ${near[0]}`, s.box))
    }
  }
  const once = new Map(issues.map((issue) => [`${issue.kind} ${issue.text}`, issue]))
  return [...once.values()].slice(0, MOST)
}

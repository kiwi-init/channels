import { Children, Fragment, isValidElement, useEffect, useRef, useState, type KeyboardEvent as KeyPress, type ReactElement, type ReactNode } from "react"

import Markdown from "~/chat/markdown"
import { cx, Loading } from "~/kit/bits"
import { Empty as Blank } from "~/kit/empty"
import { Field, Toggle } from "~/kit/form"
import { Icon, type IconName } from "~/kit/icons"
import { ago } from "~/kit/time"
import { filtered } from "~/mods/frame/filter"
import { keysLabel, onMac, pressed, shortcut, type Shortcut } from "~/mods/frame/keys"
import { copy, failed, modFetch, openUrl } from "~/mods/frame/wire"

type Run = () => void | Promise<void>

export interface ActionProps {
  title: string
  icon?: IconName
  shortcut?: string
  style?: "default" | "danger"
  onAction: Run
}

interface OpenProps {
  url: string
  title?: string
  shortcut?: string
}

interface CopyProps {
  content: string
  title?: string
  shortcut?: string
}

interface Accessory {
  text?: string
  tag?: string
  date?: Date | number | string
  icon?: IconName
}

interface ItemProps {
  id?: string
  title: string
  subtitle?: string
  icon?: IconName
  keywords?: string[]
  accessories?: Accessory[]
  actions?: ReactNode
}

interface SectionProps {
  title?: string
  children?: ReactNode
}

interface Shown {
  title: string | undefined
  items: ItemProps[]
}

interface Act {
  title: string
  icon: IconName | undefined
  keys: Shortcut | null
  danger: boolean
  run: () => void
}

const MAC = onMac()

const nothing = (): void => {}

const safely = (f: Run) => (): void => void Promise.resolve().then(f).catch(failed)

const keysOf = (text: string | undefined): Shortcut | null => (text ? shortcut(text) : null)

const fromAction = (p: ActionProps): Act => ({ title: String(p.title), icon: p.icon, keys: keysOf(p.shortcut), danger: p.style === "danger", run: safely(p.onAction) })

const fromOpen = (p: OpenProps): Act => ({ title: p.title ?? "Open in Browser", icon: "link", keys: keysOf(p.shortcut), danger: false, run: () => openUrl(p.url) })

const fromCopy = (p: CopyProps): Act => ({ title: p.title ?? "Copy", icon: "copy", keys: keysOf(p.shortcut), danger: false, run: () => copy(p.content) })

function flat(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return
    if (child.type === Fragment || child.type === Actions) out.push(...flat(child.props.children))
    else out.push(child)
  })
  return out
}

function actsOf(node: ReactNode): Act[] {
  return flat(node).flatMap((el): Act[] => {
    if (el.type === ActionItem) return [fromAction(el.props as ActionProps)]
    if (el.type === OpenInBrowser) return [fromOpen(el.props as OpenProps)]
    if (el.type === CopyToClipboard) return [fromCopy(el.props as CopyProps)]
    return []
  })
}

function useShortcuts(acts: Act[]): void {
  useEffect(() => {
    if (!acts.some((a) => a.keys)) return
    const key = (e: KeyboardEvent) => {
      const hit = acts.find((a) => a.keys && pressed(e, a.keys, MAC))
      if (!hit) return
      e.preventDefault()
      hit.run()
    }
    addEventListener("keydown", key)
    return () => removeEventListener("keydown", key)
  }, [acts])
}

function Keys({ keys }: { keys: Shortcut | null }) {
  return keys ? <kbd className="palette-kbd">{keysLabel(keys, MAC)}</kbd> : null
}

function Bar({ acts, lead }: { acts: Act[]; lead?: ReactNode }) {
  useShortcuts(acts)
  if (!acts.length && !lead) return null
  return (
    <div className="mod-actions">
      {lead}
      {acts.map((a, i) => (
        <button key={`${i}:${a.title}`} type="button" className={cx("btn", a.danger ? "is-danger" : !lead && i === 0 && "is-primary")} onClick={a.run}>
          {a.icon && <Icon name={a.icon} size={14} />}
          <span>{a.title}</span>
          <Keys keys={a.keys} />
        </button>
      ))}
    </div>
  )
}

export function Actions({ children }: { children?: ReactNode }) {
  return <Bar acts={actsOf(children)} />
}

function ActionItem(props: ActionProps) {
  return <Bar acts={[fromAction(props)]} />
}

function OpenInBrowser(props: OpenProps) {
  return <Bar acts={[fromOpen(props)]} />
}

function CopyToClipboard(props: CopyProps) {
  return <Bar acts={[fromCopy(props)]} />
}

export const Action = Object.assign(ActionItem, { OpenInBrowser, CopyToClipboard })

function sectionsOf(node: ReactNode): Shown[] {
  const out: Shown[] = []
  for (const el of flat(node)) {
    if (el.type === SectionView) {
      const p = el.props as SectionProps
      out.push({ title: p.title, items: flat(p.children).flatMap((c) => (c.type === ItemView ? [c.props as ItemProps] : [])) })
    } else if (el.type === ItemView) {
      const last = out.at(-1)
      if (last && last.title === undefined) last.items.push(el.props as ItemProps)
      else out.push({ title: undefined, items: [el.props as ItemProps] })
    }
  }
  return out
}

function Extra({ a }: { a: Accessory }) {
  const at = a.date === undefined ? Number.NaN : new Date(a.date).getTime()
  return (
    <span className="palette-meta mod-accessory">
      {a.icon && <Icon name={a.icon} size={14} />}
      {a.tag && <span className="mod-tag">{a.tag}</span>}
      {a.text}
      {Number.isFinite(at) && ago(at)}
    </span>
  )
}

function ItemRow({ item, on, first, more, onHover, onPick, onMore }: { item: ItemProps; on: boolean; first: boolean; more: boolean; onHover: () => void; onPick: () => void; onMore: () => void }) {
  return (
    <div
      role="option"
      aria-selected={on}
      className={cx("palette-item", on && "is-on")}
      onMouseMove={onHover}
      onClick={onPick}
      onContextMenu={(e) => {
        e.preventDefault()
        onHover()
        onMore()
      }}
    >
      <span className="palette-lead">{item.icon && <Icon name={item.icon} size={16} />}</span>
      <span className="palette-label">
        {item.title}
        {item.subtitle && <span className="palette-tag"> {item.subtitle}</span>}
      </span>
      {item.accessories?.map((a, i) => (
        <Extra key={i} a={a} />
      ))}
      {on && more && (
        <button
          type="button"
          className="mod-more"
          aria-label="More actions"
          onClick={(e) => {
            e.stopPropagation()
            onMore()
          }}
        >
          <Icon name="more" size={14} />
        </button>
      )}
      {on && first && <kbd className="palette-kbd">↵</kbd>}
    </div>
  )
}

function Menu({ acts, onDone }: { acts: Act[]; onDone: () => void }) {
  return (
    <div className="mod-menu" role="menu">
      {acts.map((a, i) => (
        <button
          key={`${i}:${a.title}`}
          type="button"
          role="menuitem"
          className={cx(a.danger && "is-danger")}
          onClick={() => {
            onDone()
            a.run()
          }}
        >
          <span className="palette-lead">{a.icon && <Icon name={a.icon} size={14} />}</span>
          <span className="palette-label">{a.title}</span>
          {i === 0 ? <kbd className="palette-kbd">↵</kbd> : <Keys keys={a.keys} />}
        </button>
      ))}
    </div>
  )
}

interface ListProps {
  children?: ReactNode
  searchBarPlaceholder?: string
  filtering?: boolean
  isLoading?: boolean
  searchText?: string
  onSearchTextChange?: (text: string) => void
  emptyView?: ReactNode
}

function ListView({ children, searchBarPlaceholder = "Search", filtering = true, isLoading = false, searchText, onSearchTextChange, emptyView }: ListProps) {
  const [typed, setTyped] = useState("")
  const [at, setAt] = useState(0)
  const [menu, setMenu] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const query = searchText ?? typed
  const sections = sectionsOf(children)
  const shown = filtering ? filtered(sections, query) : sections
  const items = shown.flatMap((s) => s.items)
  const on = items.length ? Math.min(at, items.length - 1) : -1
  const acts = actsOf(items[on]?.actions)
  const starts = shown.map((_, si) => shown.slice(0, si).reduce((n, s) => n + s.items.length, 0))
  useShortcuts(acts)

  useEffect(() => {
    list.current?.querySelector(".palette-item.is-on")?.scrollIntoView({ block: "nearest" })
  }, [on])

  const type = (text: string) => {
    setTyped(text)
    setAt(0)
    setMenu(false)
    onSearchTextChange?.(text)
  }
  const key = (e: KeyPress<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setMenu(false)
      if (items.length) setAt((on + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length)
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      setMenu(false)
      acts[0]?.run()
    } else if (e.key === "Escape") {
      if (menu) setMenu(false)
      else if (query) type("")
    }
  }
  const none = query.trim() ? `Nothing matches “${query.trim()}”.` : "Nothing here yet."

  return (
    <div className="mod-list">
      <div className="palette-search">
        <Icon name="search" size={16} />
        <input className="palette-input" value={query} placeholder={searchBarPlaceholder} aria-label={searchBarPlaceholder} onChange={(e) => type(e.target.value)} onKeyDown={key} />
        {isLoading && <span className="mod-busy" role="status" aria-label="Loading" />}
      </div>
      <div ref={list} className="palette-list" role="listbox">
        {items.length === 0 && !isLoading && (emptyView ?? <p className="palette-none">{none}</p>)}
        {shown.map((s, si) => (
          <div key={`${si}:${s.title ?? ""}`} className="palette-group" role="group" aria-label={s.title}>
            {s.title && (
              <div className="palette-heading" aria-hidden="true">
                {s.title}
              </div>
            )}
            {s.items.map((item, ii) => {
              const n = (starts[si] ?? 0) + ii
              return (
                <ItemRow
                  key={item.id ?? `${ii}:${item.title}`}
                  item={item}
                  on={n === on}
                  first={acts.length > 0}
                  more={acts.length > 1}
                  onHover={() => setAt(n)}
                  onPick={() => {
                    setAt(n)
                    actsOf(item.actions)[0]?.run()
                  }}
                  onMore={() => setMenu(true)}
                />
              )
            })}
          </div>
        ))}
      </div>
      {menu && acts.length > 0 && <Menu acts={acts} onDone={() => setMenu(false)} />}
    </div>
  )
}

function Rows({ sections }: { sections: Shown[] }) {
  return (
    <div className="palette-list">
      {sections.map((s, si) => (
        <div key={`${si}:${s.title ?? ""}`} className="palette-group">
          {s.title && <div className="palette-heading">{s.title}</div>}
          {s.items.map((item, ii) => (
            <ItemRow key={item.id ?? `${ii}:${item.title}`} item={item} on={false} first={false} more={false} onHover={nothing} onPick={() => actsOf(item.actions)[0]?.run()} onMore={nothing} />
          ))}
        </div>
      ))}
    </div>
  )
}

function SectionView(props: SectionProps) {
  return <Rows sections={[{ title: props.title, items: sectionsOf(props.children).flatMap((s) => s.items) }]} />
}

function ItemView(props: ItemProps) {
  return <Rows sections={[{ title: undefined, items: [props] }]} />
}

export const List = Object.assign(ListView, { Section: SectionView, Item: ItemView })

export function Detail({ markdown, isLoading = false, actions }: { markdown: string; isLoading?: boolean; actions?: ReactNode }) {
  return (
    <div className="mod-detail">
      {isLoading ? <Loading /> : <Markdown markdown={String(markdown)} onMention={nothing} onTask={nothing} onMessage={nothing} onImage={nothing} onShown={nothing} />}
      <Bar acts={actsOf(actions)} />
    </div>
  )
}

type FormValues = Record<string, string | boolean>

function valuesOf(form: HTMLFormElement): FormValues {
  const out: FormValues = {}
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) || !el.name) continue
    out[el.name] = el.dataset["kind"] === "checkbox" ? el.value === "true" : el.value
  }
  return out
}

interface FormProps {
  children?: ReactNode
  onSubmit?: (values: FormValues) => void | Promise<void>
  submitTitle?: string
  isLoading?: boolean
  actions?: ReactNode
}

function FormView({ children, onSubmit, submitTitle = "Submit", isLoading = false, actions }: FormProps) {
  const form = useRef<HTMLFormElement>(null)
  const submit = () => {
    const f = form.current
    if (!f || !onSubmit) return
    const values = valuesOf(f)
    safely(() => onSubmit(values))()
  }
  const send = onSubmit && (
    <button type="submit" className="btn is-primary">
      <span>{submitTitle}</span>
      <kbd className="palette-kbd">{MAC ? "⌘↵" : "Ctrl+↵"}</kbd>
    </button>
  )
  return (
    <form
      ref={form}
      className="mod-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !(MAC ? e.metaKey : e.ctrlKey)) return
        e.preventDefault()
        submit()
      }}
    >
      {isLoading ? <Loading /> : children}
      <Bar acts={actsOf(actions)} lead={send} />
    </form>
  )
}

interface TextProps {
  id: string
  title: string
  placeholder?: string
  defaultValue?: string
  info?: string
}

function TextField({ id, title, placeholder, defaultValue, info }: TextProps) {
  return (
    <Field label={title} hint={info}>
      <input className="input" name={id} placeholder={placeholder} defaultValue={defaultValue} />
    </Field>
  )
}

function TextArea({ id, title, placeholder, defaultValue, info }: TextProps) {
  return (
    <Field label={title} hint={info}>
      <textarea className="input mod-textarea" name={id} rows={4} placeholder={placeholder} defaultValue={defaultValue} />
    </Field>
  )
}

function Checkbox({ id, title, label, defaultValue = false, info }: { id: string; title: string; label?: string; defaultValue?: boolean; info?: string }) {
  const [on, setOn] = useState(defaultValue)
  return (
    <Field label={title} hint={info}>
      <span className="mod-check">
        <Toggle on={on} onChange={setOn} label={label ?? title} />
        {label && <span>{label}</span>}
      </span>
      <input type="hidden" name={id} data-kind="checkbox" value={String(on)} />
    </Field>
  )
}

function DropdownView({ id, title, defaultValue, info, children }: { id: string; title: string; defaultValue?: string; info?: string; children?: ReactNode }) {
  return (
    <Field label={title} hint={info}>
      <select className="input" name={id} defaultValue={defaultValue}>
        {children}
      </select>
    </Field>
  )
}

function DropdownItem({ value, title }: { value: string; title: string }) {
  return <option value={value}>{title}</option>
}

export const Form = Object.assign(FormView, { TextField, TextArea, Checkbox, Dropdown: Object.assign(DropdownView, { Item: DropdownItem }) })

export function Empty({ title, description, icon, actions }: { title: string; description?: string; icon?: IconName; actions?: ReactNode }) {
  return (
    <div className="mod-empty">
      <Blank title={title} icon={icon}>
        {description}
      </Blank>
      <Bar acts={actsOf(actions)} />
    </div>
  )
}

interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  parse?: "json" | "text"
}

export function useFetch<T = unknown>(url: string | null, options: FetchOptions = {}): { data: T | undefined; error: Error | undefined; isLoading: boolean; revalidate: () => void } {
  const [round, setRound] = useState(0)
  const ask = url === null ? null : JSON.stringify([url, options.method ?? "GET", options.headers ?? {}, options.body ?? null, options.parse ?? "json", round])
  const [got, setGot] = useState<{ ask: string; data?: T; error?: Error } | null>(null)
  useEffect(() => {
    if (ask === null) return
    const [to, method, headers, body, parse] = JSON.parse(ask) as [string, string, Record<string, string>, string | null, "json" | "text"]
    let live = true
    modFetch(to, { method, headers, body })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${to} answered ${r.status}${r.statusText ? ` ${r.statusText}` : ""}`)
        return (parse === "text" ? await r.text() : await r.json()) as T
      })
      .then(
        (data) => {
          if (live) setGot({ ask, data })
        },
        (e: unknown) => {
          if (live) setGot({ ask, error: e instanceof Error ? e : new Error(String(e)) })
        }
      )
    return () => {
      live = false
    }
  }, [ask])
  const now = got?.ask === ask ? got : null
  return { data: now?.data, error: now?.error, isLoading: ask !== null && now === null, revalidate: () => setRound((n) => n + 1) }
}

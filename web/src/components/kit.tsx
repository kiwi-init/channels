import { Component, createContext, useContext, useEffect, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from "react"

import type { Color, MemberPicture } from "@kiwi/core/protocol.ts"
import { PALETTE } from "@/lib/characters"
import { initials } from "@/lib/format"
import { noteSignInGone } from "@/lib/session"
import { later, onLoadFailed } from "@/lib/later"
import { uiFailed } from "@/lib/ui-boot"
import { cx } from "@/lib/utils"
import { HarnessFace } from "./harness-face"
import { Tooltip } from "./ui/tooltip"

// The few pieces everything is built from. Neutral by default; the accent
// (solid ink) is reserved for the one thing on screen you're most likely to do
// next. Menus, tooltips and popovers live in ./ui, on Base UI.

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 active:opacity-80",
  secondary: "text-ink shadow-[inset_0_0_0_1px_var(--edge-strong)] hover:bg-wash",
  ghost: "text-ink-2 hover:bg-wash hover:text-ink",
  danger: "text-alert hover:bg-[color-mix(in_srgb,var(--alert)_9%,transparent)]",
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: "sm" | "md" | "lg"
}) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-[opacity,background-color,color] duration-120 select-none disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-(--control) rounded-row px-2.5 text-ui",
        size === "md" && "h-8 rounded-ctl px-3.5 text-ui",
        size === "lg" && "h-10 rounded-ctl px-5 text-body",
        BUTTON[variant],
        className
      )}
      {...props}
    />
  )
}

/** A control that's only an icon. Its label shows as a tooltip and is what screen readers say. */
export function IconButton({
  className,
  label,
  active,
  round,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
  /** A round button: the header bar's actions. Ghost, like the rest: no outline, a fill only on hover. */
  round?: boolean
  ref?: Ref<HTMLButtonElement>
}) {
  // On glass (the floating header), the glass is its fill: hover brightens it, and on reads as ink.
  const glass = /(^|\s)glass(\s|$)/.test(className ?? "")
  return (
    <Tooltip label={label}>
      <button
        type={type}
        aria-label={label}
        className={cx(
          "relative inline-flex shrink-0 items-center justify-center transition-colors duration-120 disabled:opacity-40",
          round ? "rounded-full" : "rounded-ctl",
          !/(^|\s)size-/.test(className ?? "") && "size-8",
          glass
            ? active
              ? "bg-ink text-canvas"
              : "data-popup-open:bg-(--glass-fill-hover)"
            : active
              ? "bg-wash-2 text-ink"
              : "text-ink-2 hover:bg-wash hover:text-ink data-popup-open:bg-wash-2 data-popup-open:text-ink",
          className
        )}
        {...props}
      />
    </Tooltip>
  )
}

export function Checkbox({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="checkbox" className={cx("size-4 shrink-0 accent-[var(--accent)]", className)} {...props} />
}

export const FIELD = "bg-(--well) text-ink transition-shadow outline-none placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1px_var(--edge-strong)] focus-visible:outline-none"

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("h-9 w-full rounded-ctl px-3 text-body", FIELD, className)} {...props} />
}

/** People's pictures in the open channel, by member name: a person with one wears it instead of initials. */
export const Pictures = createContext<ReadonlyMap<string, MemberPicture>>(new Map())

export const Harnesses = createContext<ReadonlyMap<string, string>>(new Map())

/**
 * Who someone is, at a glance: a circle with their initials, or the picture they published. A person wears their own pick (their
 * agents wear it too), or a quiet grey; an agent with no pick gets a steady hue from its name.
 * `working` puts a ring in the in-progress blue around an agent's.
 */
export function Monogram({
  name,
  hue,
  agent,
  size = 28,
  online,
  color,
  working,
  picture,
  className,
}: {
  name: string
  hue?: string
  /** This person's picture, when it isn't the open channel's to know (your own face in the list). */
  picture?: MemberPicture | null
  /** An agent: with no colour of its own, it wears a steady hue from its name. */
  agent?: boolean
  size?: number
  online?: boolean
  color?: Color | null
  working?: boolean
  className?: string
}) {
  const tone = color ? PALETTE[color] : null
  const letters = initials(name)
  const known = useContext(Pictures).get(hue ?? name)
  const harness = useContext(Harnesses).get(hue ?? name)
  const face = agent ? null : (picture ?? known ?? null)
  return (
    <span className={cx("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {agent ? (
        <HarnessFace harness={harness} size={size} working={working} />
      ) : face ? (
        <img
          src={`data:${face.mime};base64,${face.data}`}
          alt=""
          draggable={false}
          className={cx("size-full rounded-full bg-wash-2 object-cover select-none", working && "shadow-[0_0_0_1.5px_var(--canvas),0_0_0_3px_var(--doing)]")}
        />
      ) : (
        <span
          className={cx(
            "flex size-full items-center justify-center rounded-full font-semibold tracking-[-0.01em] text-white select-none",
            !tone && "bg-[linear-gradient(180deg,var(--avatar-top),var(--avatar-bottom))]",
            working && "shadow-[0_0_0_1.5px_var(--canvas),0_0_0_3px_var(--doing)]"
          )}
          style={{
            ...(tone && { background: `linear-gradient(180deg, ${tone.fill}, color-mix(in srgb, ${tone.fill} 72%, black))`, color: tone.ink }),
            fontSize: Math.round(size * (letters.length > 1 ? 0.38 : 0.44)),
          }}
        >
          {letters}
        </span>
      )}
      {agent && working && (
        <span
          className="absolute -top-0.5 -right-0.5 rounded-full bg-doing shadow-[0_0_0_2px_var(--canvas)]"
          style={{ width: Math.max(7, Math.round(size * 0.26)), height: Math.max(7, Math.round(size * 0.26)) }}
          title="Working"
        />
      )}
      {online && (
        <span
          className="absolute -right-0.5 -bottom-0.5 rounded-full bg-live shadow-[0_0_0_2px_var(--canvas)]"
          style={{ width: Math.max(7, Math.round(size * 0.26)), height: Math.max(7, Math.round(size * 0.26)) }}
          title="Online"
        />
      )}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-label="Loading" className={cx("inline-block size-4 animate-spin rounded-full border-[1.5px] border-wash-2 border-t-ink-2", className)} />
}

/** Text tabs: the current one in ink, the rest quiet. Arrow keys move between them. */
/** One segmented control, everywhere: a wash track, and the chosen option raised on it. */
export const SEGMENTED = "rounded-ctl bg-wash p-0.5"
export const SEGMENT_ON = "bg-segment text-ink shadow-[0_0_0_1px_var(--edge-strong)]"
export const SEGMENT_OFF = "text-ink-2 hover:text-ink"

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  stretch,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  stretch?: boolean
  label?: string
}) {
  return (
    <div
      className={cx("flex items-center gap-0.5", stretch && SEGMENTED)}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
        e.preventDefault()
        const at = options.findIndex((o) => o.value === value)
        const next = options[(at + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length]!
        onChange(next.value)
        // currentTarget is cleared once the handler returns, so keep the list for the next frame.
        const list = e.currentTarget
        requestAnimationFrame(() => list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex h-7 items-center justify-center gap-1.5 rounded-row px-2.5 text-ui font-medium transition-colors duration-120",
            stretch && "flex-1",
            o.value === value ? (stretch ? SEGMENT_ON : "bg-wash-2 text-ink") : SEGMENT_OFF
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

type ModalProps = { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; roomy?: boolean; closeLabel?: string }
type AlertProps = { open: boolean; onClose: () => void; title: ReactNode; message?: ReactNode; children: ReactNode }

const dialogs = () => import("./kit-dialog")
const modal = later<ModalProps>(() => dialogs().then((m) => m.Modal))
const alert = later<AlertProps>(() => dialogs().then((m) => m.Alert))

export const Modal = modal.View
export const Alert = alert.View

// ---------- toasts ----------

interface ToastItem {
  id: number
  text: string
  tone?: "error"
  leaving?: boolean
}

let toasts: ToastItem[] = []
const listeners = new Set<() => void>()
let nextId = 1

function emit() {
  for (const l of listeners) l()
}

/** A short notice at the bottom of the window. */
export function toast(text: string, tone?: "error") {
  if (toasts.some((t) => t.text === text && t.tone === tone)) return
  const id = nextId++
  toasts = [...toasts.slice(-2), { id, text, tone }]
  emit()
  setTimeout(
    () => {
      toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t))
      emit()
      setTimeout(() => {
        toasts = toasts.filter((t) => t.id !== id)
        emit()
      }, 160)
    },
    tone === "error" ? 6000 : 2200
  )
}

export function Toaster() {
  useEffect(() => onLoadFailed(() => toast("Part of Channels couldn't load. Reload to try again.", "error")), [])
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts
  )
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            "max-w-md rounded-card px-3.5 py-2 text-ui font-medium shadow-pop",
            t.leaving ? "animate-leave" : "animate-rise",
            t.tone === "error" ? "bg-alert-fill text-white" : "bg-ink text-canvas"
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

/** The wordmark: the product, then the company that makes it, quietly. Type does the work. */
export function Wordmark({ className, byline = true }: { className?: string; byline?: boolean }) {
  return (
    <span className={cx("inline-flex items-baseline gap-[0.35em] whitespace-nowrap", className)}>
      <span className="font-semibold tracking-[-0.03em] text-ink">Channels</span>
      {byline && <span className="text-[max(0.42em,11px)] font-medium tracking-[-0.01em] text-ink-3">by Kiwi Init</span>}
    </span>
  )
}

/** What to tell someone about a failure. A gone sign-in is also reported, so the page can sign out. */
export function errorText(err: unknown): string {
  if (noteSignInGone(err)) return "Your sign-in expired. Sign in again to keep going."
  return err instanceof Error ? err.message : String(err)
}

/** If a view crashes, keep the app alive: say so, and offer a way back. `whole`: the last net, around everything. */
export class Boundary extends Component<{ children: ReactNode; resetKey?: string; whole?: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    if (this.props.whole) uiFailed(error)
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8">
        <div className="max-w-xs">
          <p className="text-body font-semibold">{this.props.whole ? "Channels hit a problem" : "This view hit a problem"}</p>
          <p className="mt-1 text-ui leading-normal text-ink-2">
            {this.props.whole ? "Nothing was lost: your channels and keys are still in this browser. Reload to carry on." : "Nothing was lost. Reload to try again; your other channels still work."}
          </p>
          <Button className="mt-4" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}

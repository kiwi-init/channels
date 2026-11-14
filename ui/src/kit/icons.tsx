import {
  Activity01Icon,
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp02Icon,
  BotIcon,
  BubbleChatIcon,
  Cancel01Icon,
  Copy01Icon,
  DocumentValidationIcon,
  Folder01Icon,
  GithubIcon,
  GitPullRequestIcon,
  Home01Icon,
  Image01Icon,
  InboxIcon,
  InformationCircleIcon,
  MinusSignIcon,
  MoreHorizontalIcon,
  Search01Icon,
  Settings02Icon,
  SidebarLeftIcon,
  SquareIcon,
  Tick02Icon,
  UserMultipleIcon,
  UserQuestion01Icon,
} from "@hugeicons/core-free-icons"
import { createElement } from "react"

export type Glyph = readonly (readonly [string, { readonly [key: string]: string | number }])[]

export const ISSUE: Glyph = [
  ["circle", { cx: "12", cy: "12", r: "8.5", stroke: "currentColor", strokeWidth: "1.5" }],
  ["circle", { cx: "12", cy: "12", r: "2", fill: "currentColor" }],
]

const GLYPHS = {
  send: ArrowUp02Icon,
  plus: Add01Icon,
  image: Image01Icon,
  minus: MinusSignIcon,
  more: MoreHorizontalIcon,
  expand: SquareIcon,
  restore: Copy01Icon,
  close: Cancel01Icon,
  search: Search01Icon,
  updates: Activity01Icon,
  reply: ArrowTurnBackwardIcon,
  thread: BubbleChatIcon,
  check: Tick02Icon,
  chevron: ArrowRight01Icon,
  down: ArrowDown01Icon,
  back: ArrowLeft01Icon,
  forward: ArrowRight01Icon,
  copy: Copy01Icon,
  folder: Folder01Icon,
  pr: GitPullRequestIcon,
  issue: ISSUE,
  github: GithubIcon,
  people: UserMultipleIcon,
  home: Home01Icon,
  sidebar: SidebarLeftIcon,
  tray: InboxIcon,
  gear: Settings02Icon,
  spec: DocumentValidationIcon,
  agent: BotIcon,
  needs: UserQuestion01Icon,
  info: InformationCircleIcon,
} satisfies Record<string, Glyph>

export type IconName = keyof typeof GLYPHS

const STROKE = 1.8
const ROUND = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.5" } as const

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return <GlyphIcon glyph={GLYPHS[name]} size={size} label={label} />
}

/** An icon from its glyph, for a screen that loads later and brings its own (the GitHub mark on sign-in). */
export function GlyphIcon({ glyph, size = 16, label }: { glyph: Glyph; size?: number; label?: string | undefined }) {
  return (
    <svg
      className="icon"
      width={`${size / 16}rem`}
      height={`${size / 16}rem`}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {glyph.map(([tag, glyphAttrs], i) => {
        const attrs = "stroke" in glyphAttrs || "fill" in glyphAttrs ? glyphAttrs : { ...glyphAttrs, ...ROUND }
        return createElement(tag, { ...attrs, ...("strokeWidth" in attrs ? { strokeWidth: STROKE } : {}), key: i })
      })}
    </svg>
  )
}

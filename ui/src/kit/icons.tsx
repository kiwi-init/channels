import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp02Icon,
  AtIcon,
  BotIcon,
  BubbleChatIcon,
  Cancel01Icon,
  CommandLineIcon,
  ComputerIcon,
  ComputerPhoneSyncIcon,
  Copy01Icon,
  Download01Icon,
  Folder01Icon,
  GitPullRequestIcon,
  HashtagIcon,
  Home01Icon,
  InboxCheckIcon,
  InboxIcon,
  InformationCircleIcon,
  Link01Icon,
  LockIcon,
  LinkSquare02Icon,
  MinusSignIcon,
  Moon02Icon,
  Notification01Icon,
  PaintBoardIcon,
  Search01Icon,
  Settings02Icon,
  SidebarLeftIcon,
  SmartPhone01Icon,
  SquareIcon,
  Sun03Icon,
  TaskDone01Icon,
  Tick02Icon,
  UserCircleIcon,
  UserQuestion01Icon,
} from "@hugeicons/core-free-icons"
import { createElement } from "react"

type Glyph = readonly (readonly [string, { readonly [key: string]: string | number }])[]

const GLYPHS = {
  send: ArrowUp02Icon,
  plus: Add01Icon,
  minus: MinusSignIcon,
  expand: SquareIcon,
  close: Cancel01Icon,
  search: Search01Icon,
  reply: ArrowTurnBackwardIcon,
  thread: BubbleChatIcon,
  check: Tick02Icon,
  chevron: ArrowRight01Icon,
  down: ArrowDown01Icon,
  back: ArrowLeft01Icon,
  external: LinkSquare02Icon,
  computer: ComputerIcon,
  phone: SmartPhone01Icon,
  link: Link01Icon,
  copy: Copy01Icon,
  folder: Folder01Icon,
  pr: GitPullRequestIcon,
  hash: HashtagIcon,
  lock: LockIcon,
  home: Home01Icon,
  at: AtIcon,
  sidebar: SidebarLeftIcon,
  sun: Sun03Icon,
  moon: Moon02Icon,
  download: Download01Icon,
  terminal: CommandLineIcon,
  tray: InboxIcon,
  gear: Settings02Icon,
  tasks: TaskDone01Icon,
  agent: BotIcon,
  needs: UserQuestion01Icon,
  clear: InboxCheckIcon,
  account: UserCircleIcon,
  paint: PaintBoardIcon,
  bell: Notification01Icon,
  devices: ComputerPhoneSyncIcon,
  info: InformationCircleIcon,
} satisfies Record<string, Glyph>

export type IconName = keyof typeof GLYPHS

const STROKE = 1.8

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return <GlyphIcon glyph={GLYPHS[name]} size={size} label={label} />
}

/** An icon from its glyph, for a screen that loads later and brings its own (the GitHub mark on sign-in). */
export function GlyphIcon({ glyph, size = 16, label }: { glyph: Glyph; size?: number; label?: string | undefined }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {glyph.map(([tag, attrs], i) => createElement(tag, { ...attrs, ...("strokeWidth" in attrs ? { strokeWidth: STROKE } : {}), key: i }))}
    </svg>
  )
}

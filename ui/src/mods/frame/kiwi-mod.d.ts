declare module "@kiwi/mod" {
  import type { ComponentType, HTMLAttributes, ReactElement, ReactNode } from "react"

  export type IconName =
    | "send"
    | "plus"
    | "image"
    | "minus"
    | "more"
    | "expand"
    | "close"
    | "search"
    | "reply"
    | "thread"
    | "check"
    | "chevron"
    | "down"
    | "back"
    | "computer"
    | "phone"
    | "link"
    | "copy"
    | "folder"
    | "pr"
    | "issue"
    | "github"
    | "people"
    | "home"
    | "at"
    | "sidebar"
    | "tray"
    | "gear"
    | "tasks"
    | "spec"
    | "agent"
    | "needs"
    | "account"
    | "info"

  export type GlyphName =
    | "pr-open"
    | "pr-draft"
    | "pr-merged"
    | "pr-closed"
    | "issue-open"
    | "issue-done"
    | "issue-dropped"
    | "check-pass"
    | "check-fail"
    | "check-running"
    | "check-waiting"
    | "check-skipped"
    | "branch"
    | "out"

  export interface ModMessage {
    seq: number
    text: string
    author: string
    from: string
    channelId: string
    at: number
    room: string | null
    link: string
  }

  export interface View {
    title: string
    render: ComponentType
  }

  export function panel(view: View): void
  export function sidebar(view: View): void
  export function command(command: { id: string; title: string; run: () => void | Promise<void> }): void
  export function messageAction(action: { id: string; title: string; run: (message: ModMessage) => void | Promise<void> }): void
  export function tab(view: View & { shown?: boolean; alert?: string | null; hint?: string | null }): void
  export function showTab(next: { shown?: boolean; alert?: string | null; hint?: string | null }): void
  export function title(title: string): void
  export function copy(text: string, note?: string): void
  export function afk(view: { after: number | null; backdrop?: "scene" | null; render: ComponentType }): void
  export function leave(): void
  export function useStill(): boolean

  export interface Channel {
    code: string
    title: string
    needs: number
    last: number
    line: string | null
  }

  export function channels(): Channel[] | null
  export function useChannels(): Channel[] | null

  export interface Room {
    channel: string
    title: string
    room: string
  }

  export function post(message: { channel: string; room: string; text: string }): Promise<void>
  export function rooms(): Room[]
  export function useRooms(): Room[]

  export interface RoomMessage {
    id: number
    author: string
    text: string
    at: number
  }

  export function messages(channel: string, room: string): RoomMessage[]
  export function useMessages(channel: string, room: string): RoomMessage[]

  export type Target = { kind: "pr" | "issue"; repo: string; number: number } | { kind: "view"; view: string }

  export function show(target: Target): void
  export function onShow(run: (target: Target) => void): () => void
  export function useShowing(): Target | null
  export function open(to: { kind: "task"; id: number } | { kind: "settings" } | { kind: "chat" } | { kind: "channel"; code: string }): void

  export type TaskStatus = "todo" | "doing" | "review" | "landing" | "done" | "waiting"

  export interface Person {
    name: string
    kind: "agent" | "human"
    color?: string
    picture?: string
    presence: string
    [more: string]: unknown
  }

  export interface GithubCheck {
    name: string
    state: "pass" | "fail" | "running" | "waiting" | "skipped"
    word: string
    required?: boolean
    url?: string
  }

  export interface GithubPullRequest {
    repo: string
    number: number
    title: string
    url: string
    state: "open" | "draft" | "merged" | "closed"
    checks: "pass" | "fail" | "running" | "none"
    ticks?: { passed: number; running: number; failed: readonly string[] }
    list?: readonly GithubCheck[]
    additions?: number
    deletions?: number
    files?: number
    branch?: string
    by?: string
    at?: number
    task?: number
    release?: string
  }

  export interface GithubIssue {
    repo: string
    number: number
    title: string
    url: string
    state: "open" | "closed"
    reason?: string
    by?: string
    at: number
    task?: number
  }

  export interface GithubTask {
    id: number
    title: string
    status: TaskStatus
    owner: { nickname: string; person: Person | null } | null
  }

  export interface Github {
    repos: string[]
    prs: GithubPullRequest[]
    issues: GithubIssue[]
    tasks: GithubTask[]
    health: unknown
  }

  export function github(): Github | null
  export function useGithub(): Github | null

  export interface Attachment {
    kind: string
    name: string
    html: string
    dark: boolean
    full: boolean
  }

  export function render(kind: string, draw: (attachment: Attachment) => ReactNode | void): void
  export function fetch(input: string | URL, init?: { method?: string; headers?: HeadersInit; body?: string | null }): Promise<Response>
  export function settings(): Readonly<Record<string, string | boolean | null>>

  export interface ModTerminal {
    id: string
    room: string
    channel: string
    agent: string
    in: "tmux" | "rex"
    waits: { asks: number; tasks: number[] }
  }

  export function terminals(): Promise<ModTerminal[]>
  export function onTerminals(listen: (list: ModTerminal[]) => void): () => void
  export function focusTerminal(to: string | { room: string; agent: string }): Promise<void>
  export function markTerminal(id: string, mark: Partial<{ asks: number; tasks: number[] }> | null): Promise<void>

  export function Button(props: { children: ReactNode; onClick?: () => void; kind?: "primary" | "quiet" | "danger"; disabled?: boolean }): ReactElement
  export function Row(props: { title: ReactNode; sub?: ReactNode; onClick?: () => void }): ReactElement
  export function Field(props: { label: string; hint?: string; children: ReactNode }): ReactElement
  export function Icon(props: { name: IconName | GlyphName; size?: number; label?: string }): ReactElement
  export function Avatar(props: { person: Person | undefined; size?: "sm" | "md" | "lg"; pip?: boolean }): ReactElement
  export function Dot(props: { status: TaskStatus }): ReactElement
  export function Count(props: { n: number; loud?: boolean }): ReactElement | null
  export function Heading(props: { children: ReactNode; action?: ReactNode }): ReactElement
  export function Track(props: HTMLAttributes<HTMLDivElement>): ReactElement
  export function ago(at: number, now?: number): string
  export function cx(...parts: (string | false | null | undefined)[]): string

  export interface ActionProps {
    title: string
    icon?: IconName
    shortcut?: string
    style?: "default" | "danger"
    onAction: () => void | Promise<void>
  }

  export const Action: {
    (props: ActionProps): ReactElement | null
    OpenInBrowser(props: { url: string; title?: string; shortcut?: string }): ReactElement | null
    CopyToClipboard(props: { content: string; title?: string; shortcut?: string }): ReactElement | null
  }

  export function Actions(props: { children?: ReactNode }): ReactElement | null

  export interface Accessory {
    text?: string
    tag?: string
    date?: Date | number | string
    icon?: IconName
  }

  export interface ListItemProps {
    id?: string
    title: string
    subtitle?: string
    icon?: IconName
    keywords?: string[]
    accessories?: Accessory[]
    actions?: ReactNode
  }

  export const List: {
    (props: {
      children?: ReactNode
      searchBarPlaceholder?: string
      filtering?: boolean
      isLoading?: boolean
      searchText?: string
      onSearchTextChange?: (text: string) => void
      emptyView?: ReactNode
    }): ReactElement | null
    Section(props: { title?: string; children?: ReactNode }): ReactElement | null
    Item(props: ListItemProps): ReactElement | null
  }

  export function Detail(props: { markdown: string; isLoading?: boolean; actions?: ReactNode }): ReactElement | null

  export type FormValues = Record<string, string | boolean>

  export interface TextFieldProps {
    id: string
    title: string
    placeholder?: string
    defaultValue?: string
    info?: string
  }

  export const Form: {
    (props: { children?: ReactNode; onSubmit?: (values: FormValues) => void | Promise<void>; submitTitle?: string; isLoading?: boolean; actions?: ReactNode }): ReactElement | null
    TextField(props: TextFieldProps): ReactElement | null
    TextArea(props: TextFieldProps): ReactElement | null
    Checkbox(props: { id: string; title: string; label?: string; defaultValue?: boolean; info?: string }): ReactElement | null
    Dropdown: {
      (props: { id: string; title: string; defaultValue?: string; info?: string; children?: ReactNode }): ReactElement | null
      Item(props: { value: string; title: string }): ReactElement | null
    }
  }

  export function Empty(props: { title: string; description?: string; icon?: IconName; actions?: ReactNode; children?: ReactNode }): ReactElement | null

  export const Toast: {
    show(toast: { title: string; message?: string; style?: "success" | "failure" }): void
  }

  export function useFetch<T = unknown>(
    url: string | null,
    options?: { method?: string; headers?: Record<string, string>; body?: string; parse?: "json" | "text" }
  ): { data: T | undefined; error: Error | undefined; isLoading: boolean; revalidate: () => void }

  export const storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
    keys(): Promise<string[]>
  }
}

declare module "*.css" {}

declare module "*.svg" {
  const url: string
  export default url
}

declare module "*.png" {
  const url: string
  export default url
}

declare module "*.jpg" {
  const url: string
  export default url
}

declare module "*.jpeg" {
  const url: string
  export default url
}

declare module "*.gif" {
  const url: string
  export default url
}

declare module "*.webp" {
  const url: string
  export default url
}

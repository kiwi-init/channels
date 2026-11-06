declare module "@kiwi/mod" {
  import type { ComponentType, ReactElement, ReactNode } from "react"

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

  export interface ModMessage {
    seq: number
    text: string
    author: string
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
  export function fetch(input: string | URL, init?: { method?: string; headers?: HeadersInit; body?: string | null }): Promise<Response>

  export function Button(props: { children: ReactNode; onClick?: () => void; kind?: "primary" | "quiet" | "danger"; disabled?: boolean }): ReactElement
  export function Row(props: { title: ReactNode; sub?: ReactNode; onClick?: () => void }): ReactElement
  export function Field(props: { label: string; hint?: string; children: ReactNode }): ReactElement
  export function Icon(props: { name: IconName; size?: number; label?: string }): ReactElement

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

  export function Empty(props: { title: string; description?: string; icon?: IconName; actions?: ReactNode }): ReactElement | null

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

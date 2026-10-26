import { createContext, useContext } from "react"

import type { JoinRequest, Member as RosterMember, PersonPowers } from "@kiwi/core/membership.ts"
import type { Persona, Personality } from "@kiwi/core/personality.ts"
import type { ChannelIcon, Color } from "@kiwi/core/protocol.ts"
import type { Scope } from "@kiwi/core/scopes.ts"
import type { SecretInput } from "@kiwi/core/client.ts"
import type { SecretView } from "@kiwi/core/secrets.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import type { Exported } from "@/lib/log-export"

export type Confirm =
  | { kind: "approve"; req: JoinRequest; powers?: PersonPowers }
  | { kind: "remove"; member: RosterMember }
  | { kind: "scopes"; member: RosterMember }
  | { kind: "persona"; member: RosterMember }
  | { kind: "nickname"; member: RosterMember }
  | { kind: "color"; member: RosterMember }
  | { kind: "close" }
  | { kind: "leave" }
  | null

interface SecretsApi {
  list: () => Promise<SecretView[]>
  value: (id: string) => Promise<string>
  save: (input: SecretInput) => Promise<SecretView>
  remove: (id: string) => Promise<void>
}

export interface ControlsProps {
  code: string
  myKey: string
  isOwner: boolean
  roster: RosterMember[]
  requests: JoinRequest[]
  online: Map<string, unknown>
  /** An agent's one status (agent-strip.tsx agentNow), so details says what the sidebar and Agents tab say. */
  statusOf?: (name: string) => { text: string; busy: boolean } | undefined
  state: ChannelState
  now: number
  onApprove: (r: JoinRequest, scopes?: Scope[], persona?: Persona, powers?: PersonPowers) => Promise<void>
  onDeny: (r: JoinRequest) => Promise<void>
  onCheck: (r: JoinRequest) => Promise<void>
  onRemove: (m: RosterMember) => Promise<void>
  onScopes?: (m: RosterMember, scopes: Scope[]) => Promise<void>
  onPersona?: (m: RosterMember, persona: Persona | null) => Promise<void>
  onPin?: (p: Personality) => Promise<string>
  onNickname?: (m: RosterMember, nickname: string | null) => Promise<void>
  onColor?: (m: RosterMember, color: Color | null) => Promise<void>
  onPowers?: (m: RosterMember, powers: PersonPowers) => Promise<void>
  onCloseChannel: () => Promise<void>
  onLeaveChannel: () => Promise<void>
  exportLog: () => Promise<Exported>
  onRename?: (name: string) => Promise<void>
  onIcon?: (icon: ChannelIcon | null) => Promise<void>
  onHold?: (on: boolean, note?: string) => Promise<void>
  onCharter?: (text: string | null) => Promise<void>
  onRepos?: (repos: string[]) => Promise<void>
  onGithubWrite?: (on: boolean) => Promise<void>
  onBranchPrefix?: (prefix: string | null) => Promise<void>
  onMakeRoom?: (name: string) => Promise<string>
  onRenameRoom?: (id: string, name: string) => Promise<void>
  secrets?: SecretsApi
  title?: string
  roomId?: string
}

export interface Api {
  p: ControlsProps
  busy: boolean
  run: (fn: () => Promise<void>, done: string) => Promise<void>
  ask: (c: Confirm) => void
  editScopes: (m: RosterMember) => void
  editPersona: (m: RosterMember) => void
  editNickname: (m: RosterMember) => void
  editColor: (m: RosterMember) => void
  lastSeenOf: (name: string) => number | null
  onlineNow: (name: string) => boolean
  openDialog: (d: "rename" | "charter" | "branch") => void
}

export const Ctx = createContext<Api | null>(null)

export const useControls = () => useContext(Ctx)!

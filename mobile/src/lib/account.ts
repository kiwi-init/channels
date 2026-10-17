import { BackupError, WrongPassphrase, getBackup, openBackup, passphraseProblem, type BackupEnvelope } from "@mc/backup.ts"
import type { ChannelIdentityView, PersonView } from "../../../desktop/src/bridge.ts"

export const NO_BACKUP = "This account has no backup yet. On your computer, open Settings and choose Back up."
export const WRONG_WORDS = "Those words do not open this backup. Check them against what you wrote down."

export interface Restored {
  name: string
  channels: number
}

interface Contents {
  person: PersonView
  channels: ChannelIdentityView[]
}

const text = (v: unknown): v is string => typeof v === "string" && v.length > 0

function isContents(v: unknown): v is Contents {
  if (!v || typeof v !== "object") return false
  const c = v as { person?: Record<string, unknown>; channels?: unknown }
  const p = c.person
  return (
    !!p &&
    text(p.name) &&
    text(p.pk) &&
    text(p.sk) &&
    text(p.xpk) &&
    text(p.xsk) &&
    Array.isArray(c.channels) &&
    c.channels.every((e) => !!e && typeof e === "object" && text((e as { pk?: unknown }).pk) && text((e as { sk?: unknown }).sk))
  )
}

export async function fetchAccountBackup(relay: string, token: string, fetchImpl?: typeof fetch): Promise<BackupEnvelope> {
  const got = await getBackup(relay, token, fetchImpl).catch((e: unknown) => {
    throw e instanceof BackupError && e.status === 401 ? new Error("The relay did not accept this sign-in.") : e
  })
  if (!got) throw new Error(NO_BACKUP)
  return got.envelope
}

export async function restoreFromBackup(
  engine: { adopt: (person: PersonView, channels: readonly ChannelIdentityView[]) => Promise<void> },
  envelope: BackupEnvelope,
  passphrase: string
): Promise<Restored> {
  const problem = passphraseProblem(passphrase)
  if (problem) throw new Error(problem)
  const contents = await openBackup(passphrase, envelope, isContents).catch((e: unknown) => {
    throw e instanceof WrongPassphrase ? new Error(WRONG_WORDS) : e
  })
  await engine.adopt(contents.person, contents.channels)
  return { name: contents.person.name, channels: contents.channels.length }
}

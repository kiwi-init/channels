const DEVICE_URL = "https://api.workos.com/user_management/authorize/device"
const TOKEN_URL = "https://api.workos.com/user_management/authenticate"

export const NO_SIGN_IN = "This relay has no account sign-in."
export const DID_NOT_START = "The sign-in did not start. Try again."
export const TIMED_OUT = "Sign-in took too long. Try again."
export const DECLINED = "Sign-in was declined."

export interface SignInDeps {
  relay: string
  open: (url: string) => Promise<void>
  devName?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  signal?: AbortSignal
}

export type SignInStep = { step: "starting" } | { step: "waiting"; userCode: string }

interface RelayConfig {
  workosClientId?: string | null
  dev?: boolean
}

interface DeviceStart {
  device_code?: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

interface Tokens {
  access_token?: string
  expires_in?: number
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

export function verifyUrlOf(start: DeviceStart): string | null {
  const given = start.verification_uri_complete ?? (start.verification_uri ? `${start.verification_uri}?user_code=${encodeURIComponent(start.user_code ?? "")}` : null)
  return given && URL.canParse(given) && new URL(given).protocol === "https:" ? given : null
}

export async function signIn(deps: SignInDeps, on: (step: SignInStep) => void = () => {}): Promise<string> {
  const http = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? wait
  const now = deps.now ?? Date.now
  on({ step: "starting" })
  const res = await http(new URL("/v1/config", deps.relay))
  if (!res.ok) throw new Error(`The relay answered ${res.status}.`)
  const config = (await res.json()) as RelayConfig
  if (config.dev) {
    if (!deps.devName) throw new Error(NO_SIGN_IN)
    return `dev:${deps.devName}`
  }
  if (!config.workosClientId) throw new Error(NO_SIGN_IN)

  const started = await http(DEVICE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: config.workosClientId, scope: "openid profile email offline_access" }),
  })
  const start = (await started.json().catch(() => ({}))) as DeviceStart
  const url = verifyUrlOf(start)
  if (!start.device_code || !url) throw new Error(DID_NOT_START)
  on({ step: "waiting", userCode: start.user_code ?? "" })
  await deps.open(url)

  const until = now() + (start.expires_in ?? 600) * 1000
  for (;;) {
    await sleep((start.interval ?? 5) * 1000)
    if (deps.signal?.aborted) throw new Error(DECLINED)
    const polled = await http(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code, client_id: config.workosClientId }),
    })
    if (polled.status === 400) {
      const err = ((await polled.json().catch(() => ({}))) as { error?: string }).error
      if (err === "authorization_pending" || err === "slow_down") {
        if (now() > until) throw new Error(TIMED_OUT)
        continue
      }
      throw new Error(DECLINED)
    }
    if (!polled.ok) throw new Error(`Sign-in failed (${polled.status}).`)
    const tokens = (await polled.json()) as Tokens
    if (!tokens.access_token) throw new Error(DID_NOT_START)
    return tokens.access_token
  }
}

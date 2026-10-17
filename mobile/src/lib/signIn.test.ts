import { DECLINED, DID_NOT_START, NO_SIGN_IN, TIMED_OUT, signIn, verifyUrlOf } from "./signIn"

type Reply = { status?: number; json: unknown }

function fakeFetch(replies: Record<string, Reply[]>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const next = replies[url]?.shift()
    if (!next) throw new Error(`unexpected ${url}`)
    const status = next.status ?? 200
    return { ok: status < 400, status, json: async () => next.json } as Response
  }) as typeof fetch
  return { fetchImpl, calls }
}

const CONFIG = "https://relay.test/v1/config"
const DEVICE = "https://api.workos.com/user_management/authorize/device"
const TOKEN = "https://api.workos.com/user_management/authenticate"
const started = { device_code: "dc", user_code: "ABCD-EFGH", verification_uri_complete: "https://auth.test/device?user_code=ABCD-EFGH", expires_in: 600, interval: 1 }

const base = (fetchImpl: typeof fetch, open = jest.fn(async () => {})) => ({ relay: "https://relay.test", open, fetchImpl, sleep: async () => {}, now: () => 0 })

describe("signIn", () => {
  it("opens the sign-in page, shows the code, waits, and returns the access token", async () => {
    const { fetchImpl } = fakeFetch({
      [CONFIG]: [{ json: { workosClientId: "client_1" } }],
      [DEVICE]: [{ json: started }],
      [TOKEN]: [{ status: 400, json: { error: "authorization_pending" } }, { status: 400, json: { error: "slow_down" } }, { json: { access_token: "tok" } }],
    })
    const open = jest.fn(async () => {})
    const steps: string[] = []
    const token = await signIn(base(fetchImpl, open), (s) => steps.push(s.step === "waiting" ? `waiting ${s.userCode}` : s.step))
    expect(token).toBe("tok")
    expect(open).toHaveBeenCalledWith("https://auth.test/device?user_code=ABCD-EFGH")
    expect(steps).toEqual(["starting", "waiting ABCD-EFGH"])
  })

  it("only opens an https page", () => {
    expect(verifyUrlOf({ verification_uri_complete: "https://a.test/x" })).toBe("https://a.test/x")
    expect(verifyUrlOf({ verification_uri_complete: "file:///etc/passwd" })).toBeNull()
    expect(verifyUrlOf({ verification_uri_complete: "kiwi://join/x" })).toBeNull()
    expect(verifyUrlOf({ verification_uri: "https://a.test/d", user_code: "A B" })).toBe("https://a.test/d?user_code=A%20B")
  })

  it("says so when the relay has no sign-in, the start fails, it is declined or it takes too long", async () => {
    await expect(signIn(base(fakeFetch({ [CONFIG]: [{ json: {} }] }).fetchImpl))).rejects.toThrow(NO_SIGN_IN)
    await expect(
      signIn(base(fakeFetch({ [CONFIG]: [{ json: { workosClientId: "c" } }], [DEVICE]: [{ json: { device_code: "x", verification_uri_complete: "file:///x" } }] }).fetchImpl))
    ).rejects.toThrow(DID_NOT_START)
    await expect(
      signIn(base(fakeFetch({ [CONFIG]: [{ json: { workosClientId: "c" } }], [DEVICE]: [{ json: started }], [TOKEN]: [{ status: 400, json: { error: "access_denied" } }] }).fetchImpl))
    ).rejects.toThrow(DECLINED)
    let t = 0
    const slow = {
      ...base(fakeFetch({ [CONFIG]: [{ json: { workosClientId: "c" } }], [DEVICE]: [{ json: started }], [TOKEN]: [{ status: 400, json: { error: "authorization_pending" } }] }).fetchImpl),
      now: () => (t += 700_000),
    }
    await expect(signIn(slow)).rejects.toThrow(TIMED_OUT)
  })

  it("a dev relay takes a name, no browser", async () => {
    const open = jest.fn(async () => {})
    expect(await signIn({ ...base(fakeFetch({ [CONFIG]: [{ json: { dev: true } }] }).fetchImpl, open), devName: "phone" })).toBe("dev:phone")
    expect(open).not.toHaveBeenCalled()
  })
})

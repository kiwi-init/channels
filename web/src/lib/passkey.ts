import { b64url, fromB64url } from "@mc/crypto.ts"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

// Passkeys as a key, not as a login: WorkOS signs you in, and a passkey's PRF
// output (32 bytes only that authenticator can produce, for this site and this
// salt) unlocks your vault. Nothing here is checked by a server, so the
// challenge is random and only the PRF result matters.
//
// Each step is an Effect that fails with what went wrong, by name: the browser's
// DOMExceptions are read once, here (passkeyFailure), and nowhere else.

export interface PrfSecret {
  credentialId: string
  secret: Uint8Array<ArrayBuffer>
}

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer } }

// ---------- what can go wrong ----------

/** The person closed the prompt, or it timed out: not an error worth a red toast. */
export class PasskeyCancelled extends Data.TaggedError("PasskeyCancelled")<{ readonly cause: unknown }> {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}

/** The passkey worked but can't produce a PRF secret (older authenticators, some password managers). */
export class PrfUnsupported extends Data.TaggedError("PrfUnsupported") {
  override get message(): string {
    return "This passkey can’t unlock a vault. Use another one (iCloud Keychain, Google Password Manager, Windows Hello or a recent security key), or your recovery code."
  }
}

/** The browser gave back no credential at all. */
export class NoPasskey extends Data.TaggedError("NoPasskey")<{ readonly message: string }> {}

/** Anything else the browser refused with (a key already made here, a page that isn't secure): its own text. */
export class PasskeyFailed extends Data.TaggedError("PasskeyFailed")<{ readonly cause: unknown }> {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}

export type PasskeyError = PasskeyCancelled | PrfUnsupported | NoPasskey | PasskeyFailed

/** What a WebAuthn call threw, by meaning. */
function passkeyFailure(cause: unknown): PasskeyCancelled | PasskeyFailed {
  const dismissed = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "AbortError")
  return dismissed ? new PasskeyCancelled({ cause }) : new PasskeyFailed({ cause })
}

/** Whether a step stopped because the person closed the passkey prompt. */
export const cancelled = (err: unknown): err is PasskeyCancelled => err instanceof PasskeyCancelled

// ---------- the steps ----------

/** Whether this browser can make and use passkeys at all. PRF support itself only shows when one is used. */
export async function passkeysAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === "undefined" || !window.isSecureContext) return false
  const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.().catch(() => null)
  if (caps && caps["extension:prf"] === false) return false
  return true
}

function prfOf(cred: PublicKeyCredential): PrfResults | undefined {
  return (cred.getClientExtensionResults() as { prf?: PrfResults }).prf
}

const webAuthn = (f: () => Promise<Credential | null>) => Effect.tryPromise({ try: () => f() as Promise<PublicKeyCredential | null>, catch: passkeyFailure })

/**
 * Make a passkey for this site and return its PRF secret. Some authenticators
 * only give PRF output when the key is used, so a second touch may follow.
 */
export const createPasskey = Effect.fn("createPasskey")(function* (user: { id: string; name: string; displayName: string }, salt: Uint8Array<ArrayBuffer>, exclude: string[] = []) {
  const cred = yield* webAuthn(() =>
    navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: "Channels" },
        user: { id: new TextEncoder().encode(user.id), name: user.name, displayName: user.displayName },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        excludeCredentials: exclude.map((id) => ({ type: "public-key" as const, id: fromB64url(id) })),
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })
  )
  if (!cred) return yield* new NoPasskey({ message: "No passkey was made." })
  const prf = prfOf(cred)
  const credentialId = b64url(new Uint8Array(cred.rawId))
  if (prf?.results?.first) return { credentialId, secret: new Uint8Array(prf.results.first) } satisfies PrfSecret
  if (prf?.enabled === false) return yield* new PrfUnsupported()
  return yield* touchPasskey(salt, [credentialId])
})

/** Touch a passkey and get its PRF secret. With several credentials, one prompt covers them all. */
export const touchPasskey = Effect.fn("touchPasskey")(function* (salt: Uint8Array<ArrayBuffer>, credentialIds: string[]) {
  const cred = yield* webAuthn(() =>
    navigator.credentials.get({
      publicKey: {
        rpId: location.hostname,
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: credentialIds.map((id) => ({ type: "public-key" as const, id: fromB64url(id) })),
        userVerification: "required",
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })
  )
  if (!cred) return yield* new NoPasskey({ message: "No passkey was used." })
  const first = prfOf(cred)?.results?.first
  if (!first) return yield* new PrfUnsupported()
  return { credentialId: b64url(new Uint8Array(cred.rawId)), secret: new Uint8Array(first) } satisfies PrfSecret
})

import { signRequest } from "./auth.ts";
import type { DeviceLink } from "./devices.ts";
import { accountScope, type EnrollAnswer, type EnrollAsk, type Enrollment } from "./enroll.ts";
import type { Identity } from "./identity.ts";
import type { RecoveryLink, Vault } from "./recovery.ts";

export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export interface AccountClient {
  links(): Promise<unknown[]>;
  publish(links: DeviceLink[]): Promise<void>;
  enrollment(): Promise<Enrollment | null>;
  answer(id: string, answer: EnrollAnswer): Promise<void>;
  drop(id: string): Promise<void>;
  ask(ask: EnrollAsk): Promise<string>;
  reveal(id: string, nonce: string): Promise<void>;
  vault(): Promise<{ recovery: unknown[]; vault: unknown }>;
  keepVault(update: { recovery?: RecoveryLink[]; vault?: Vault }): Promise<void>;
}

export function accountClient(relay: string, token: () => Promise<string>, device: Identity, fetchImpl: typeof fetch = fetch): AccountClient {
  let user: string | null = null;
  const call = async (method: string, path: string, body?: unknown, opts: { signed?: boolean; missing?: boolean } = {}): Promise<Response> => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { "x-human-token": await token() };
    if (opts.signed !== false) headers.authorization = `Bearer ${await signRequest(device, accountScope(await me()), method, path, text)}`;
    if (text) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetchImpl(new URL(path, relay), { method, headers, ...(text ? { body: text } : {}) });
    } catch (err) {
      throw new AccountError(0, `couldn't reach ${relay}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.ok || (opts.missing && res.status === 404)) return res;
    const why = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    throw new AccountError(res.status, why ?? `the relay returned ${res.status}`);
  };
  const read = async () => {
    const res = await call("GET", "/v1/account", undefined, { signed: false });
    const got = (await res.json()) as { user: string; links: unknown[] };
    user = got.user;
    return got;
  };
  const me = async () => user ?? (await read()).user;
  return {
    links: async () => (await read()).links,
    publish: async (links) => void (await call("PUT", "/v1/account", { links })),
    enrollment: async () => {
      const res = await call("GET", "/v1/account/ask", undefined, { missing: true });
      return res.status === 404 ? null : ((await res.json()) as Enrollment);
    },
    answer: async (id, answer) => void (await call("PUT", `/v1/account/ask/${id}/answer`, answer)),
    drop: async (id) => void (await call("DELETE", `/v1/account/ask/${id}`)),
    ask: async (ask) => ((await (await call("POST", "/v1/account/ask", { ask })).json()) as { id: string }).id,
    reveal: async (id, nonce) => void (await call("PUT", `/v1/account/ask/${id}/reveal`, { nonce })),
    vault: async () => (await (await call("GET", "/v1/account/vault", undefined, { signed: false })).json()) as { recovery: unknown[]; vault: unknown },
    keepVault: async (update) => void (await call("PUT", "/v1/account/vault", update)),
  };
}

export async function moveAccount(relay: string, from: () => Promise<string>, github: string, to: string, signer: Identity, fetchImpl: typeof fetch = fetch): Promise<void> {
  const ask = async (method: string, path: string, headers: Record<string, string>, text = ""): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchImpl(new URL(path, relay), { method, headers: { "x-human-token": await from(), ...headers }, ...(text ? { body: text } : {}) });
    } catch (err) {
      throw new AccountError(0, `couldn't reach ${relay}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.ok) return res;
    const why = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    throw new AccountError(res.status, why ?? `the relay returned ${res.status}`);
  };
  const { user } = (await (await ask("GET", "/v1/account", {})).json()) as { user: string };
  if (user === to) return;
  const text = JSON.stringify({ to });
  await ask(
    "POST",
    "/v1/account/move",
    { authorization: `Bearer ${await signRequest(signer, accountScope(user), "POST", "/v1/account/move", text)}`, "x-human-token-to": github, "content-type": "application/json" },
    text,
  );
}

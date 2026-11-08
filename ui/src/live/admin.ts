import { relayUrl } from "@kiwi/secrets/relay.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import type { Actions, AdminPerson } from "~/model"

async function asAdmin<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await bridge()?.getToken()
  if (!token) return null
  const res = await fetch(`${relayUrl()}${path}`, { ...init, headers: { "x-human-token": token, "content-type": "application/json" } })
  if (res.status === 401 || res.status === 403 || res.status === 404) return null
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `the relay returned ${res.status}`)
  return (await res.json()) as T
}

export const adminPeople: Actions["adminPeople"] = async () => {
  try {
    return (await asAdmin<{ people: AdminPerson[] }>("/v1/admin/people"))?.people ?? null
  } catch {
    // An older relay, or no reach to it: the People page just stays hidden.
    return null
  }
}

export const setAdminPerson: Actions["setAdminPerson"] = (user, change) => asAdmin<AdminPerson>(`/v1/admin/people/${user}`, { method: "PUT", body: JSON.stringify(change) })

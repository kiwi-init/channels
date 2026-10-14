/** One pass over an owned channel's join requests. */

export interface TendApi {
  autoApprove: (person: string) => Promise<readonly { name: string }[]>
  requests: (opts: { person: string }) => Promise<readonly { id: string; name: string }[]>
}

/**
 * Approve own computers' agents, then announce whoever is still waiting — including
 * own-computer requests auto-approve did not let in (it threw, or returned none).
 */
export async function tendOwned(
  person: string,
  title: string,
  api: TendApi,
  ping: (title: string, body: string) => void,
  told: Set<string>,
): Promise<void> {
  let letIn: readonly { name: string }[] = []
  try {
    letIn = await api.autoApprove(person)
  } catch {
    // Still list remaining requests.
  }
  if (letIn.length) ping(title, letIn.length === 1 ? `${letIn[0]!.name} joined from your computer` : `${letIn.length} of your agents joined`)
  let remaining: readonly { id: string; name: string }[] = []
  try {
    remaining = await api.requests({ person })
  } catch {
    return
  }
  for (const r of remaining) {
    if (told.has(r.id)) continue
    told.add(r.id)
    ping(title, `${r.name} asks to join`)
  }
}

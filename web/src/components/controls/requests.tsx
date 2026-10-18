import { useEffect } from "react"

import { TOO_MANY_REQUESTS } from "@kiwi/core/sas.ts"
import { formatAgo } from "@/lib/format"
import { AgentFacts } from "../agent-facts"
import { Button, Monogram } from "../kit"
import { useControls } from "./context"

export function Requests({ onDone }: { onDone: () => void }) {
  const { p, busy, run, ask } = useControls()
  const requests = p.requests
  const empty = requests.length === 0
  useEffect(() => {
    if (empty) onDone()
  }, [empty, onDone])
  return (
    <div className="p-5">
      <h2 className="text-title font-semibold tracking-[-0.01em]">{requests.length > 1 ? `${requests.length} want to join` : "Wants to join"}</h2>
      <p className="mt-1 text-ui leading-normal text-ink-2">Show the code, compare it with theirs, then approve.</p>
      {requests.some((r) => r.check === "unchecked") && <p className="mt-3 rounded-card bg-wash p-3 text-ui leading-normal text-ink-2">{TOO_MANY_REQUESTS}</p>}
      <div className="mt-4 grid gap-4">
        {requests.length === 0 && <p className="text-ui text-ink-3">Nobody’s waiting.</p>}
        {requests.map((r) => (
          <div key={r.id} className="flex items-start gap-3">
            <Monogram name={r.display || r.name} hue={r.name} agent={r.kind !== "human"} size={28} />
            <div className="min-w-0 flex-1">
              {
                <p className="truncate text-ui font-medium">
                  {r.display || r.name}
                  {r.display && <span className="font-normal text-ink-3"> @{r.name}</span>}
                  {r.role && <span className="font-normal text-ink-2">, {r.role}</span>}
                  {r.askedAs && r.askedAs !== r.name && <span className="font-normal text-ink-2"> (asked as {r.askedAs}, which is taken)</span>}
                </p>
              }
              <p className="text-meta leading-snug text-ink-2">
                {r.kind === "human" ? "A person" : r.computer ? `Agent on ${r.computer.personName}’s ${r.computer.label}` : "Agent"} · asked {formatAgo(r.ts, p.now)}
              </p>
              {r.kind !== "human" && <AgentFacts card={r.card} runs={r.runs} said repos={p.state.repos} className="mt-1" />}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => run(() => p.onDeny(r), `Declined ${r.name}`)}>
                  Decline
                </Button>
                {r.check === "ready" ? (
                  <Button size="sm" onClick={() => ask({ kind: "approve", req: r })}>
                    Review and approve
                  </Button>
                ) : r.check === "unchecked" ? (
                  <Button size="sm" disabled={busy} onClick={() => run(() => p.onCheck(r), `Asked ${r.name} for its code`)}>
                    Show code
                  </Button>
                ) : (
                  <span className="self-center text-meta text-ink-3">Waiting for {r.kind === "human" ? "their" : "its"} code…</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

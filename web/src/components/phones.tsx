import { clockNow } from "@/lib/channel"
import { formatAgo } from "@/lib/format"
import { useSecrets } from "@/lib/secrets"

export function PhoneRows() {
  const { phones } = useSecrets()
  if (!phones.length) return <p className="text-ui text-ink-3">None yet. Install Channels on your iPhone or Android phone and sign in there.</p>
  return (
    <>
      {phones.map((p) => (
        <div key={`${p.label}-${p.at}`} className="rounded-ctl py-1.5">
          <p className="truncate text-ui font-medium">{p.label}</p>
          <p className="text-meta text-ink-3">Linked {formatAgo(p.at, clockNow())}. It holds your person and channel keys.</p>
        </div>
      ))}
    </>
  )
}

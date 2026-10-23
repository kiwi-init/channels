import { harnessUrl } from "@/lib/avatars"
import { harnessName, knownHarness, monoHarness } from "@/lib/harness"

export function HarnessFace({ harness, size }: { harness: string | undefined; size: number }) {
  const known = knownHarness(harness)
  const mark = Math.round(size * 0.86)
  const url = known ? harnessUrl(known) : ""
  const mask = `url(${JSON.stringify(url)})`
  return (
    <span role="img" aria-label={known ? harnessName(known) : "Agent"} title={known ? harnessName(known) : undefined} className="flex size-full items-center justify-center rounded-full select-none">
      {known && url ? (
        monoHarness(known) ? (
          <span
            aria-hidden
            className="bg-ink"
            style={{
              width: mark,
              height: mark,
              maskImage: mask,
              WebkitMaskImage: mask,
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
            }}
          />
        ) : (
          <img src={url} alt="" width={mark} height={mark} draggable={false} />
        )
      ) : (
        <svg aria-hidden width={mark} height={mark} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="text-ink-2">
          <rect x="2.5" y="3.5" width="19" height="17" rx="4" />
          <path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5" />
        </svg>
      )}
    </span>
  )
}

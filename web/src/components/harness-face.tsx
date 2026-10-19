import { ComputerTerminal01Icon } from "@hugeicons/core-free-icons"

import { harnessUrl } from "@/lib/avatars"
import { harnessName, knownHarness, monoHarness } from "@/lib/harness"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

export function HarnessFace({ harness, size, working }: { harness: string | undefined; size: number; working?: boolean }) {
  const known = knownHarness(harness)
  const mark = Math.round(size * 0.58)
  const url = known ? harnessUrl(known) : ""
  const mask = `url(${JSON.stringify(url)})`
  return (
    <span
      role="img"
      aria-label={known ? harnessName(known) : "Agent"}
      title={known ? harnessName(known) : undefined}
      className={cx("flex size-full items-center justify-center rounded-full bg-wash-2 select-none", working && "shadow-[0_0_0_1.5px_var(--canvas),0_0_0_3px_var(--doing)]")}
    >
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
        <Icon icon={ComputerTerminal01Icon} size={mark} className="text-ink-2" />
      )}
    </span>
  )
}

import { excerpt } from "@/lib/format"
import { cx } from "@/lib/utils"

export function AskedBelow({ body, first }: { body: string; first: boolean }) {
  return (
    <p className={cx("flex min-w-0 items-baseline gap-2 text-ui", first && "mt-0.5")}>
      <span className="min-w-0 truncate text-ink-3">{excerpt(body, 140)}</span>
      <span className="shrink-0 text-meta font-medium text-decide">Answer it below</span>
    </p>
  )
}

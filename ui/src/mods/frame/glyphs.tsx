import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CircleDashedIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LinkSquare02Icon,
  Loading03Icon,
  MinusSignCircleIcon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons"

import { GlyphIcon, Icon as AppIcon, ISSUE, type Glyph, type IconName } from "~/kit/icons"

const MORE: Record<string, Glyph> = {
  "pr-open": GitPullRequestIcon,
  "pr-draft": GitPullRequestDraftIcon,
  "pr-merged": GitMergeIcon,
  "pr-closed": GitPullRequestClosedIcon,
  "issue-open": ISSUE,
  "issue-done": CheckmarkCircle02Icon,
  "issue-dropped": UnavailableIcon,
  "check-pass": CheckmarkCircle02Icon,
  "check-fail": CancelCircleIcon,
  "check-running": Loading03Icon,
  "check-waiting": CircleDashedIcon,
  "check-skipped": MinusSignCircleIcon,
  branch: GitBranchIcon,
  out: LinkSquare02Icon,
}

export function Icon({ name, size, label }: { name: IconName | keyof typeof MORE; size?: number; label?: string }) {
  const more = MORE[name]
  return more ? <GlyphIcon glyph={more} size={size ?? 16} label={label} /> : <AppIcon name={name as IconName} {...(size === undefined ? {} : { size })} {...(label === undefined ? {} : { label })} />
}

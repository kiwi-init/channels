// Channels' semantic colors, in one place. Components use these, never
// hard-coded hex. One accent at a time on a screen: blue is what's yours
// and what's new; red is for alerts, amber for a decision someone waits on.

export const TASK_STATE = {
  open: { text: "text-ink-2", dot: "bg-wash-2" },
  doing: { text: "text-doing", dot: "bg-doing" },
  done: { text: "text-live", dot: "bg-live" },
} as const;

export type TaskState = keyof typeof TASK_STATE;

export const TONE = {
  alert: { text: "text-alert", wash: "bg-alert/10" },
  decide: { text: "text-decide", wash: "bg-decide-wash" },
  live: { text: "text-live", wash: "bg-live/10" },
  doing: { text: "text-doing", wash: "bg-doing/10" },
  quiet: { text: "text-ink-3", wash: "bg-wash" },
} as const;

export type Tone = keyof typeof TONE;

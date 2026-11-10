import type { Msg } from "~/i18n/en"
import { addWords } from "~/i18n/i18n"

const words = {
  "kit.failed.line": "{what} {next}",
  "kit.failed.details": "Details",
  "kit.failed.offline": "Check your connection and try again.",
  "kit.failed.signin": "Sign in again, then try again.",
  "kit.failed.denied": "You aren't allowed to do that here.",
  "kit.failed.gone": "This channel was closed, or you're no longer in it.",
  "kit.failed.missing": "It isn't there any more.",
  "kit.failed.busy": "Too much is waiting right now. Try again in a minute.",
  "kit.failed.update": "This needs a newer Channels. Update, then try again.",
  "kit.failed.other": "Try again in a moment.",
} as const satisfies Record<string, Msg>

addWords(words)

export default words

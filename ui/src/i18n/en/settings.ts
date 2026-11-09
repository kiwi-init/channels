import type { Msg } from "~/i18n/en"
import { addWords } from "~/i18n/i18n"

const words = {} as const satisfies Record<string, Msg>

addWords(words)

export default words

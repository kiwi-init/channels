import "~/i18n/en/live-later"
import type { RoomProblem } from "@kiwi/app/rooms.ts"
import { t } from "~/i18n/i18n"

export function roomProblemWords(p: RoomProblem): string {
  switch (p.kind) {
    case "unnamed":
      return t("live.room.unnamed")
    case "taken":
      return t("live.room.taken", { name: p.name })
    case "full":
      return t("live.room.full", { count: p.max })
  }
}

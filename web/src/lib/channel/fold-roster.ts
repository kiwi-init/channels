import type { Member } from "@kiwi/core/membership.ts";
import { omit } from "@kiwi/core/omit.ts";
import { toRoster, type Roster } from "@kiwi/core/state.ts";

export const foldRoster = (admitted: readonly Member[]): Roster => admitted.map((m) => omit(toRoster(m), "color"));

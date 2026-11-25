import type { Serves } from "../calls.ts";
import { searchMeaning, setTypesafeKey, typesafeKey } from "../meaning.ts";

export function meaningCalls(): Serves<"searchMeaning" | "typesafeKey" | "setTypesafeKey"> {
  return {
    searchMeaning: (ask) => searchMeaning(ask),
    typesafeKey: async () => typesafeKey(),
    setTypesafeKey: (key) => setTypesafeKey(key),
  };
}

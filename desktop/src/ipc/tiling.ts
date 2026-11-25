import type { Serves } from "../calls.ts";
import { tilingPick } from "../tiling.ts";

export function tilingCalls(): Serves<"tilingPick"> {
  return { tilingPick: (ask) => tilingPick(ask) };
}

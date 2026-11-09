import { ChannelGone, isUnreachable, RelayError } from "@kiwi/core/client/relay-errors.ts";

/** A relay outage or overload: stay on waiting and poll again. */
export function isJoinBlip(err: unknown): boolean {
  if (isUnreachable(err)) return true;
  if (err instanceof ChannelGone) return false;
  if (err instanceof RelayError) return err.status >= 500 || err.status === 429;
  return err instanceof TypeError;
}

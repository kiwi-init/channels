import { ChannelGone } from "@kiwi/core/client/relay-errors.ts";

import type { ChannelOps, FollowEvent } from "../../../desktop/src/bridge.ts";
import { errorOf } from "./channel-remote.ts";
import { isSignInGone } from "./session.ts";

type Follow = ChannelOps["follow"];

export const REFOLLOW_MS = 500;
const REFOLLOW_MAX_MS = 30_000;

function seqOf(ev: FollowEvent): number {
  if (ev._tag === "Message") return ev.message.seq;
  if (ev._tag === "Unread" || ev._tag === "Head") return ev.seq;
  return 0;
}

function final(ev: Extract<FollowEvent, { _tag: "Failed" }>): boolean {
  const err = errorOf(ev.error);
  return err instanceof ChannelGone || isSignInGone(err);
}

export function refollowing(follow: Follow, wait = REFOLLOW_MS): Follow {
  return (code, since, on, opts) => {
    let last = since;
    let next = wait;
    let stopped = false;
    let stop: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      let dead = false;
      const stopThis = follow(
        code,
        last,
        (ev) => {
          if (stopped || dead) return;
          last = Math.max(last, seqOf(ev));
          if (ev._tag === "Open") next = wait;
          on(ev);
          if (ev._tag !== "Failed" || stopped || final(ev)) return;
          dead = true;
          timer = setTimeout(() => {
            stop?.();
            start();
          }, next);
          next = Math.min(next * 2, REFOLLOW_MAX_MS);
        },
        opts,
      );
      stop = stopThis;
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stop?.();
    };
  };
}

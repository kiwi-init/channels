import { useEffect, useMemo, useState } from "react";

import type { HumanSession } from "@kiwi/core/client.ts";
import { ChannelStore, type ChannelHandle } from "./channel-store.ts";
import { makeHolds } from "./held.ts";
import type { StoredMember } from "./store.ts";

export type { ChannelHandle };

const holds = makeHolds((member, human, light) => new ChannelStore(member, human, undefined, light));

export function useChannel(member: StoredMember, human?: HumanSession | null, light = false): ChannelHandle {
  const { store, use } = useMemo(() => holds.hold(member, human, light), [member, human, light]);
  const [handle, setHandle] = useState(store.snapshot);
  useEffect(() => {
    const stop = store.subscribe(() => setHandle(store.snapshot()));
    const release = use(light);
    return () => {
      release();
      stop();
    };
  }, [store, use, light]);
  return handle.ch === store.ch ? handle : store.snapshot();
}

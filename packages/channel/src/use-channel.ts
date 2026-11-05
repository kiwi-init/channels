import { useEffect, useMemo, useState } from "react";

import type { HumanSession } from "@kiwi/core/client.ts";
import { ChannelStore, type ChannelHandle } from "./channel-store.ts";
import type { StoredMember } from "./store.ts";

export type { ChannelHandle };

export function useChannel(member: StoredMember, human?: HumanSession | null, light = false): ChannelHandle {
  const store = useMemo(() => new ChannelStore(member, human, undefined, light), [member, human, light]);
  const [handle, setHandle] = useState(store.snapshot);
  useEffect(() => {
    const stop = store.subscribe(() => setHandle(store.snapshot()));
    const close = store.open();
    return () => {
      close();
      stop();
    };
  }, [store]);
  return handle.ch === store.ch ? handle : store.snapshot();
}

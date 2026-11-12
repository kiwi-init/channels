export function inTasks<E>(on: (e: E) => void): { hand: (e: E) => void; stop: () => void } {
  const due: E[] = [];
  let channel: MessageChannel | null = null;
  let stopped = false;
  const next = (): void => {
    const e = due.shift();
    if (e !== undefined && !stopped) on(e);
  };
  return {
    hand: (e) => {
      if (stopped) return;
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = next;
      }
      due.push(e);
      channel.port2.postMessage(0);
    },
    stop: () => {
      stopped = true;
      due.length = 0;
      channel?.port1.close();
      channel?.port2.close();
      channel = null;
    },
  };
}

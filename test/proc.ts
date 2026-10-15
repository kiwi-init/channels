// Tests spawn the CLI with process.execPath, never "bun" from PATH: on some machines "bun" is a
// shell shim (pnpm), and killing the shim leaves the real bun running. That orphan keeps the
// pipes open (no EOF for the test) and keeps listening as the agent (eating its messages).
// Once a killed CLI has exited, these read what it wrote without waiting on an EOF.

/** Read `s` to its end, or until the process behind it is gone and nothing more comes. */
function drain(s: ReadableStream<Uint8Array>) {
  const reader = s.getReader();
  let text = "";
  const dec = new TextDecoder();
  const done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += dec.decode(value);
      }
    } catch {}
  })();
  return {
    get text() {
      return text;
    },
    /** Once the process has exited: what it wrote, without waiting forever on an EOF. */
    async close(): Promise<string> {
      await Promise.race([done, Bun.sleep(300)]);
      await reader.cancel().catch(() => {});
      await done;
      return text;
    },
  };
}

/** Kill `p`, wait for it to exit, and return what was left on its stderr. */
export async function killAndRead(p: { kill(): void; exited: Promise<number>; stderr: ReadableStream<Uint8Array> }): Promise<string> {
  p.kill();
  await p.exited;
  return drain(p.stderr).close();
}

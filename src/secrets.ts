import { constants } from "node:os";
import * as Effect from "effect/Effect";
import { secretNeedles, type Secret } from "@kiwi/core/secrets.ts";
import type { AgentSession } from "./agent.ts";
import { Keystore } from "./config.ts";

export const freshSecrets = (s: AgentSession) =>
  Effect.gen(function* () {
    const secrets = yield* s.ch.fx.mySecrets();
    yield* (yield* Keystore).keepSecrets(
      s.cfg.roomId,
      s.me,
      secrets.map((x) => ({ id: x.id, box: x.sealed, at: x.at })),
    );
    return secrets;
  });

const enc = new TextEncoder();

interface Needle {
  bytes: Buffer;
  label: Buffer;
}

export class Redactor {
  private carry: Buffer = Buffer.alloc(0);
  private readonly needles: Needle[];

  constructor(secrets: readonly Pick<Secret, "name" | "value">[]) {
    this.needles = secrets
      .flatMap((s) => secretNeedles(s.value).map((n) => ({ bytes: Buffer.from(enc.encode(n)), label: Buffer.from(enc.encode(`[secret ${s.name}]`)) })))
      .sort((a, b) => b.bytes.length - a.bytes.length);
  }

  push(chunk: Uint8Array): Buffer {
    const buf = Buffer.concat([this.carry, chunk]);
    const parts: Buffer[] = [];
    let i = 0;
    for (;;) {
      let best: { at: number; n: Needle } | null = null;
      for (const n of this.needles) {
        const at = buf.indexOf(n.bytes, i);
        if (at >= 0 && (!best || at < best.at)) best = { at, n };
      }
      if (!best) break;
      parts.push(buf.subarray(i, best.at), best.n.label);
      i = best.at + best.n.bytes.length;
    }
    const keep = this.partial(buf, i);
    parts.push(buf.subarray(i, buf.length - keep));
    this.carry = Buffer.from(buf.subarray(buf.length - keep));
    return Buffer.concat(parts);
  }

  end(): Buffer {
    const rest = this.carry;
    this.carry = Buffer.alloc(0);
    return rest;
  }

  private partial(buf: Buffer, from: number): number {
    let keep = 0;
    for (const n of this.needles) {
      for (let k = Math.min(n.bytes.length - 1, buf.length - from); k > keep; k--) {
        if (buf[buf.length - k] === n.bytes[0] && buf.subarray(buf.length - k).equals(n.bytes.subarray(0, k))) {
          keep = k;
          break;
        }
      }
    }
    return keep;
  }
}

const written = (to: NodeJS.WriteStream, bytes: Buffer) => new Promise<void>((done) => (bytes.length ? to.write(bytes, () => done()) : done()));

async function pump(from: ReadableStream<Uint8Array>, to: NodeJS.WriteStream, secrets: readonly Secret[]): Promise<void> {
  const redact = new Redactor(secrets);
  for await (const chunk of from) await written(to, redact.push(chunk));
  await written(to, redact.end());
}

export function shellFor(script: string): string[] {
  return process.platform === "win32" ? [process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", script] : ["/bin/sh", "-c", script];
}

export async function runWithSecrets(cmd: readonly string[], secrets: readonly Secret[]): Promise<number> {
  const proc = Bun.spawn([...cmd], {
    env: { ...process.env, ...Object.fromEntries(secrets.map((s) => [s.name, s.value])) },
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const forward = signals.map((sig) => [sig, () => proc.kill(sig)] as const);
  for (const [sig, on] of forward) process.on(sig, on);
  try {
    await Promise.all([pump(proc.stdout, process.stdout, secrets), pump(proc.stderr, process.stderr, secrets)]);
    const code = await proc.exited;
    const signal = proc.signalCode;
    return typeof signal === "string" && signal in constants.signals ? 128 + constants.signals[signal as keyof typeof constants.signals] : code;
  } finally {
    for (const [sig, on] of forward) process.off(sig, on);
  }
}

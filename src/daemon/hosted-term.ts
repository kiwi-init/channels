const BACKSLASH = 0x5c;
const SPACE = 0x20;
const OUTPUT = new TextEncoder().encode("%output ");
const EXTENDED = new TextEncoder().encode("%extended-output ");
const PANE = /^%\d{1,10}$/;
const HEX_CHUNK = 256;

export interface PaneOutput {
  pane: string;
  data: Uint8Array;
}

const isOctal = (b: number | undefined): b is number => b !== undefined && b >= 0x30 && b <= 0x37;

function unescapeOutput(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    const [x, y, z] = [bytes[i + 1], bytes[i + 2], bytes[i + 3]];
    if (b === BACKSLASH && isOctal(x) && isOctal(y) && isOctal(z)) {
      out[n++] = ((x - 0x30) << 6) | ((y - 0x30) << 3) | (z - 0x30);
      i += 3;
    } else out[n++] = b;
  }
  return out.subarray(0, n);
}

const startsWith = (line: Uint8Array, prefix: Uint8Array): boolean => line.length >= prefix.length && prefix.every((b, i) => line[i] === b);

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

export function controlOutput(line: Uint8Array): PaneOutput | null {
  const extended = startsWith(line, EXTENDED);
  if (!extended && !startsWith(line, OUTPUT)) return null;
  const from = extended ? EXTENDED.length : OUTPUT.length;
  const space = line.indexOf(SPACE, from);
  if (space < 0) return null;
  const pane = ascii(line.subarray(from, space));
  if (!PANE.test(pane)) return null;
  if (!extended) return { pane, data: unescapeOutput(line.subarray(space + 1)) };
  for (let i = space + 1; i + 2 < line.length; i++) if (line[i] === SPACE && line[i + 1] === 0x3a && line[i + 2] === SPACE) return { pane, data: unescapeOutput(line.subarray(i + 3)) };
  return null;
}

const hex = (bytes: Uint8Array): string[] => Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));

export function keyCommands(pane: string, text: string): string[] {
  const cmds: string[] = [];
  let plain = "";
  const flush = (): void => {
    if (!plain) return;
    const bytes = hex(new TextEncoder().encode(plain));
    for (let i = 0; i < bytes.length; i += HEX_CHUNK) cmds.push(`send-keys -t ${pane} -H ${bytes.slice(i, i + HEX_CHUNK).join(" ")}`);
    plain = "";
  };
  for (const run of text.match(/[\x00-\x7f]+|[^\x00-\x7f]+/gu) ?? []) {
    if (run.charCodeAt(0) < 0x80) plain += run;
    else {
      flush();
      cmds.push(`send-keys -t ${pane} -l '${run}'`);
    }
  }
  flush();
  return cmds;
}

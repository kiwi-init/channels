const ALIASES: Record<string, string> = { claude: "claude-code", kimi: "kimi-code", mimo: "mimocode", grokbot: "grok-bot" };

const NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  grok: "Grok",
  gemini: "Gemini CLI",
  cursor: "Cursor",
  "kimi-code": "Kimi Code",
  mimocode: "MiMo Code",
  "grok-bot": "Grok Bot",
  pi: "Pi",
  zcode: "ZCode",
};

const MONO = new Set(["opencode", "grok", "cursor", "mimocode", "grok-bot", "pi", "zcode"]);

export function canonicalHarness(harness: string | undefined): string | undefined {
  const h = harness?.trim().toLowerCase();
  return h ? (ALIASES[h] ?? h) : undefined;
}

export function harnessName(harness: string): string {
  return NAMES[canonicalHarness(harness) ?? ""] ?? harness;
}

export function knownHarness(harness: string | undefined): string | null {
  const h = canonicalHarness(harness);
  return h && h in NAMES ? h : null;
}

export function monoHarness(harness: string): boolean {
  return MONO.has(harness);
}

export type TextStep = "bigger" | "smaller" | "reset";

export type KeyInput = { type: string; key: string; meta: boolean; control: boolean; alt: boolean };

export function textStepFor(input: KeyInput, platform: string): TextStep | null {
  if (input.type !== "keyDown" || input.alt) return null;
  const mod = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return null;
  if (input.key === "=" || input.key === "+") return "bigger";
  if (input.key === "-" || input.key === "_") return "smaller";
  if (input.key === "0") return "reset";
  return null;
}

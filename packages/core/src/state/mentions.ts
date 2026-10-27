export const readsAsHandle = (name: string, label: string): boolean => label !== name && /[._-]/.test(name);

export const bareAt = (text: string, start: number, end: number): boolean => !"=?&#:".includes(text[start - 1] || " ") && !"@/".includes(text.slice(end).replace(/^[._-]+/, "")[0] || " ");

export function memberNamed(raw: string, labelOf: (name: string) => string | undefined): { name: string; label: string } | null {
  for (let name = raw; name; name = name.slice(0, -1)) {
    const label = labelOf(name);
    if (label !== undefined) return { name, label };
    if (!/[._-]$/.test(name)) return null;
  }
  return null;
}

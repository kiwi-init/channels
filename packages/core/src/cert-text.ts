export function clean(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2060-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

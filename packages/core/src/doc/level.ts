import * as Y from "yjs";

export const DOC_LEVEL = 1;

const RULES = "rules";
const WRITER = "writer";

export function writerFloor(doc: Y.Doc): number {
  const v = doc.getMap(RULES).get(WRITER);
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0;
}

export function raiseWriterFloor(doc: Y.Doc, level: number): boolean {
  if (writerFloor(doc) >= level) return false;
  doc.getMap(RULES).set(WRITER, level);
  return true;
}

export function onWriterFloor(doc: Y.Doc, on: () => void): () => void {
  const rules = doc.getMap(RULES);
  rules.observe(on);
  return () => rules.unobserve(on);
}

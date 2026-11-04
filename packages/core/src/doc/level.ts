import * as Y from "yjs";

export const DOC_LEVEL = 1;

const RULES = "rules";
const LEVEL = /^writer\.([1-9][0-9]{0,8})$/;

export function writerFloor(doc: Y.Doc): number {
  let floor = 0;
  for (const key of doc.getMap(RULES).keys()) {
    const level = Number(LEVEL.exec(key)?.[1] ?? 0);
    if (level > floor) floor = level;
  }
  return floor;
}

export function raiseWriterFloor(doc: Y.Doc, level: number): boolean {
  if (!Number.isSafeInteger(level) || level < 1 || writerFloor(doc) >= level) return false;
  doc.getMap(RULES).set(`writer.${level}`, true);
  return true;
}

export function onWriterFloor(doc: Y.Doc, on: () => void): () => void {
  const rules = doc.getMap(RULES);
  rules.observe(on);
  return () => rules.unobserve(on);
}

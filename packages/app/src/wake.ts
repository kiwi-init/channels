export function nudgeOnWake(
  nudge: () => void,
  win: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> = document,
): () => void {
  const onVisible = () => {
    if (doc.visibilityState === "visible") nudge();
  };
  win.addEventListener("online", nudge);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    win.removeEventListener("online", nudge);
    doc.removeEventListener("visibilitychange", onVisible);
  };
}

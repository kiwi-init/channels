const KEPT = 100;

const LAST_TAG = 0xffff_ffff;

export interface NoteLinks {
  tag(link: string | null): number;
  link(tag: number): string | null;
}

export function noteLinks(): NoteLinks {
  const links = new Map<number, string>();
  let last = 0;
  return {
    tag: (link) => {
      if (!link) return 0;
      last = last >= LAST_TAG ? 1 : last + 1;
      links.delete(last);
      links.set(last, link);
      for (const old of links.keys()) {
        if (links.size <= KEPT) break;
        links.delete(old);
      }
      return last;
    },
    link: (tag) => links.get(tag) ?? null,
  };
}

import { covers, feed, NOTHING_FED, type Fed } from "./search-feed.ts";
import { SearchIndex } from "./search-index.ts";
import { readIndexFile, removeIndexFile, writeIndexFile } from "./search-store.ts";
import type { SearchAsk, SearchCalls, SearchOp } from "./search-types.ts";

interface Open {
  index: SearchIndex;
  fed: Fed;
  file: string;
  key: string;
  roomId: string;
  dirty: boolean;
}

export class SearchCore {
  private readonly open = new Map<string, Open>();

  async handle(ask: SearchAsk): Promise<SearchCalls[SearchOp]["value"]> {
    switch (ask.op) {
      case "open":
        return this.load(ask.code, ask.file, ask.key, ask.roomId);
      case "feed": {
        const o = this.need(ask.code);
        if (!covers(o.fed, ask.from)) {
          o.index.close();
          o.index = SearchIndex.empty();
          o.fed = { base: null, from: ask.from, through: ask.from - 1 };
          o.dirty = true;
        }
        const fed = feed(o.index, o.fed, ask.messages, ask.inputs);
        if (fed !== o.fed) o.dirty = true;
        o.fed = fed;
        return { through: o.fed.through };
      }
      case "search": {
        const o = this.need(ask.code);
        return { hits: o.index.search(ask.query, ask.rooms, ask.limit), through: o.fed.through };
      }
      case "around": {
        const o = this.need(ask.code);
        return { hits: o.index.around(ask.seq, ask.rooms, ask.span), through: o.fed.through };
      }
      case "dropRoom": {
        const o = this.need(ask.code);
        o.index.dropRoom(ask.room);
        o.dirty = true;
        await this.save(o);
        return { through: o.fed.through };
      }
      case "save": {
        const o = this.open.get(ask.code);
        if (o) await this.save(o);
        return null;
      }
      case "forget": {
        const o = this.open.get(ask.code);
        this.close(ask.code);
        if (o) await removeIndexFile(o.file);
        return null;
      }
      case "unload":
        await this.unload(ask.code);
        return null;
    }
  }

  private async load(code: string, file: string, key: string, roomId: string): Promise<{ through: number }> {
    const had = this.open.get(code);
    if (had && had.file === file && had.key === key && had.roomId === roomId) return { through: had.fed.through };
    await this.unload(code).catch(() => null);
    const loaded = await readIndexFile(file, key, roomId);
    const o: Open = loaded ? { ...loaded, file, key, roomId, dirty: false } : { index: SearchIndex.empty(), fed: NOTHING_FED, file, key, roomId, dirty: false };
    this.open.set(code, o);
    return { through: o.fed.through };
  }

  private need(code: string): Open {
    const o = this.open.get(code);
    if (!o) throw new Error("this channel's search index isn't open");
    return o;
  }

  private async save(o: Open): Promise<void> {
    if (!o.dirty) return;
    o.dirty = false;
    await writeIndexFile(o.file, o.index, o.fed, o.key, o.roomId).catch((e: unknown) => {
      o.dirty = true;
      throw e;
    });
  }

  private async unload(code: string): Promise<void> {
    const o = this.open.get(code);
    if (!o) return;
    try {
      await this.save(o);
    } finally {
      this.close(code);
    }
  }

  private close(code: string): void {
    this.open.get(code)?.index.close();
    this.open.delete(code);
  }
}

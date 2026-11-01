import { feed, type Fed } from "./search-feed.ts";
import { SearchIndex } from "./search-index.ts";
import { readIndexFile, removeIndexFile, writeIndexFile } from "./search-store.ts";
import type { SearchAsk, SearchCalls, SearchOp } from "./search-types.ts";

interface Open {
  index: SearchIndex;
  fed: Fed;
  file: string;
  key: string;
  roomId: string;
}

export class SearchCore {
  private readonly open = new Map<string, Open>();

  async handle(ask: SearchAsk): Promise<SearchCalls[SearchOp]["value"]> {
    switch (ask.op) {
      case "open":
        return this.load(ask.code, ask.file, ask.key, ask.roomId);
      case "feed": {
        const o = this.need(ask.code);
        o.fed = feed(o.index, o.fed, ask.messages, ask.inputs);
        await writeIndexFile(o.file, o.index, o.fed, o.key, o.roomId);
        return { through: o.fed.through };
      }
      case "search": {
        const o = this.need(ask.code);
        return { hits: o.index.search(ask.query, ask.rooms, ask.limit), through: o.fed.through };
      }
      case "dropRoom": {
        const o = this.need(ask.code);
        o.index.dropRoom(ask.room);
        await writeIndexFile(o.file, o.index, o.fed, o.key, o.roomId);
        return { through: o.fed.through };
      }
      case "forget": {
        const o = this.open.get(ask.code);
        this.close(ask.code);
        if (o) await removeIndexFile(o.file);
        return null;
      }
      case "unload":
        this.close(ask.code);
        return null;
    }
  }

  private async load(code: string, file: string, key: string, roomId: string): Promise<{ through: number }> {
    const had = this.open.get(code);
    if (had && had.file === file && had.key === key && had.roomId === roomId) return { through: had.fed.through };
    this.close(code);
    const loaded = await readIndexFile(file, key, roomId);
    const o: Open = loaded ? { ...loaded, file, key, roomId } : { index: SearchIndex.empty(), fed: { base: null, through: 0 }, file, key, roomId };
    this.open.set(code, o);
    return { through: o.fed.through };
  }

  private need(code: string): Open {
    const o = this.open.get(code);
    if (!o) throw new Error("this channel's search index isn't open");
    return o;
  }

  private close(code: string): void {
    this.open.get(code)?.index.close();
    this.open.delete(code);
  }
}

interface Packed {
  reaction: string
  name: string
  feeling: string
}

export interface Gif extends Packed {
  key: string
  url: string
}

const packs = import.meta.glob<Packed[]>("../../../assets/reactions/index.json", { eager: true, import: "default" })
const urls = import.meta.glob<string>("../../../assets/reactions/*/*.webp", { eager: true, query: "?url", import: "default" })

const gifs: Gif[] = Object.values(packs)
  .flat()
  .flatMap((g) => {
    const url = urls[`../../../assets/reactions/${g.reaction}/${g.name}.webp`]
    return url ? [{ ...g, key: `${g.reaction}/${g.name}`, url }] : []
  })

export const gifByKey = (key: string): Gif | undefined => gifs.find((g) => g.key === key)

export const gifGroups: { reaction: string; items: Gif[] }[] = [...new Set(gifs.map((g) => g.reaction))].map((reaction) => ({
  reaction,
  items: gifs.filter((g) => g.reaction === reaction),
}))

export async function gifFile(g: Gif): Promise<File> {
  const blob = await (await fetch(g.url)).blob()
  return new File([blob], `${g.reaction}-${g.name}.webp`, { type: "image/webp" })
}

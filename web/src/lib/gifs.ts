import pack from "../../../assets/reactions/index.json"

const urls = import.meta.glob<string>("../../../assets/reactions/*/*.webp", { eager: true, query: "?url", import: "default" })

export interface Gif {
  reaction: string
  name: string
  feeling: string
  url: string
}

const gifs: Gif[] = pack.flatMap((r) => {
  const url = urls[`../../../assets/reactions/${r.reaction}/${r.name}.webp`]
  return url ? [{ ...r, url }] : []
})

export const gifByKey = (key: string): Gif | undefined => gifs.find((g) => `${g.reaction}/${g.name}` === key)

export const gifGroups: { reaction: string; items: Gif[] }[] = [...new Set(gifs.map((g) => g.reaction))].map((reaction) => ({
  reaction,
  items: gifs.filter((g) => g.reaction === reaction),
}))

export async function gifFile(g: Gif): Promise<{ name: string; mime: string; data: string }> {
  const blob = await (await fetch(g.url)).blob()
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  return { name: `${g.reaction}-${g.name}.webp`, mime: "image/webp", data: url.slice(url.indexOf(",") + 1) }
}

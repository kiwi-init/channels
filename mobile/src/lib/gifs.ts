import gif0 from "../../../assets/reactions/ok/trailer.webp"
import gif1 from "../../../assets/reactions/ok/nanalan-playful.webp"
import gif2 from "../../../assets/reactions/ok/nanalan-breeze.webp"
import gif3 from "../../../assets/reactions/ok/shaun-the-sheep.webp"
import gif4 from "../../../assets/reactions/thinking/sesame-street.webp"
import gif5 from "../../../assets/reactions/thinking/logic-problem.webp"
import gif6 from "../../../assets/reactions/thinking/reading.webp"
import gif7 from "../../../assets/reactions/thinking/confused.webp"
import gif8 from "../../../assets/reactions/blocked/the-bear-help.webp"
import gif9 from "../../../assets/reactions/blocked/pratt-help.webp"
import gif10 from "../../../assets/reactions/blocked/scared.webp"
import gif11 from "../../../assets/reactions/nope/casual-no-way.webp"
import gif12 from "../../../assets/reactions/nope/soft-no.webp"
import gif13 from "../../../assets/reactions/nope/schitts-creek.webp"
import gif14 from "../../../assets/reactions/working/cat-typing.webp"
import gif15 from "../../../assets/reactions/breaking-news/classic.webp"
import gif16 from "../../../assets/reactions/breaking-news/south-park.webp"
import gif17 from "../../../assets/reactions/celebrate/hard-work.webp"
import gif18 from "../../../assets/reactions/working/hotfix-fire.webp"
import gif19 from "../../../assets/reactions/error/stand-by.webp"
import gif20 from "../../../assets/reactions/sorry/oops.webp"
import gif21 from "../../../assets/reactions/facepalm/simon-cowell.webp"
import gif22 from "../../../assets/reactions/thanks/obama.webp"
import gif23 from "../../../assets/reactions/thanks/happy-dog.webp"
import gif24 from "../../../assets/reactions/working/preparing-to-ship.webp"
import gif25 from "../../../assets/reactions/shipping/take-off.webp"
import gif26 from "../../../assets/reactions/waiting/five-hours-later.webp"
import gif27 from "../../../assets/reactions/celebrate/classy-smug.webp"
import gif28 from "../../../assets/reactions/hello/simpsons.webp"
import gif29 from "../../../assets/reactions/facepalm/lilo-stitch-nooo.webp"

import pack from "../../../assets/reactions/index.json"

const sources: Record<string, number> = {
  "ok/trailer": gif0,
  "ok/nanalan-playful": gif1,
  "ok/nanalan-breeze": gif2,
  "ok/shaun-the-sheep": gif3,
  "thinking/sesame-street": gif4,
  "thinking/logic-problem": gif5,
  "thinking/reading": gif6,
  "thinking/confused": gif7,
  "blocked/the-bear-help": gif8,
  "blocked/pratt-help": gif9,
  "blocked/scared": gif10,
  "nope/casual-no-way": gif11,
  "nope/soft-no": gif12,
  "nope/schitts-creek": gif13,
  "working/cat-typing": gif14,
  "breaking-news/classic": gif15,
  "breaking-news/south-park": gif16,
  "celebrate/hard-work": gif17,
  "working/hotfix-fire": gif18,
  "error/stand-by": gif19,
  "sorry/oops": gif20,
  "facepalm/simon-cowell": gif21,
  "thanks/obama": gif22,
  "thanks/happy-dog": gif23,
  "working/preparing-to-ship": gif24,
  "shipping/take-off": gif25,
  "waiting/five-hours-later": gif26,
  "celebrate/classy-smug": gif27,
  "hello/simpsons": gif28,
  "facepalm/lilo-stitch-nooo": gif29,
}

export interface Gif {
  key: string
  reaction: string
  name: string
  feeling: string
  source: number
}

export const gifs: Gif[] = pack.flatMap((entry) => {
  const key = `${entry.reaction}/${entry.name}`
  const source = sources[key]
  return source === undefined ? [] : [{ key, reaction: entry.reaction, name: entry.name, feeling: entry.feeling, source }]
})

export const gifByKey = (key: string): Gif | undefined => gifs.find((gif) => gif.key === key)

export const gifGroups: { reaction: string; items: Gif[] }[] = [...new Set(gifs.map((gif) => gif.reaction))].map((reaction) => ({
  reaction,
  items: gifs.filter((gif) => gif.reaction === reaction),
}))

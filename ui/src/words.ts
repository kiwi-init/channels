import { named } from "@kiwi/app/mentions.ts"

export class Words {
  readonly #text: string

  constructor(text: string) {
    this.#text = text
  }

  static raw(value: Words): string {
    return value.#text
  }

  [Symbol.toPrimitive](): never {
    throw new TypeError("Words can't be shown raw: render it with Shown, or read it with wordsPlain or wordsRaw")
  }
}

export const wrote = (text: string): Words => new Words(text)

export const wordsRaw = (value: Words): string => Words.raw(value)

export const wordsPlain = (value: Words, nicknames: ReadonlyMap<string, string>): string => named(Words.raw(value), nicknames)

export const wordsSame = (a: Words, b: Words): boolean => Words.raw(a) === Words.raw(b)

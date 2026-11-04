export interface Quote {
  text: string
  by: string
  in: string
}

export const QUOTES: readonly Quote[] = [
  { text: "All we have to decide is what to do with the time that is given us.", by: "J. R. R. Tolkien", in: "The Fellowship of the Ring" },
  { text: "Some day you will be old enough to start reading fairy tales again.", by: "C. S. Lewis", in: "The Lion, the Witch and the Wardrobe" },
  { text: "The world will never starve for want of wonders; but only for want of wonder.", by: "G. K. Chesterton", in: "Tremendous Trifles" },
  { text: "Not all those who wander are lost.", by: "J. R. R. Tolkien", in: "The Fellowship of the Ring" },
  { text: "What? You too? I thought I was the only one.", by: "C. S. Lewis", in: "The Four Loves" },
  { text: "Be patient toward all that is unsolved in your heart and try to love the questions themselves.", by: "Rainer Maria Rilke", in: "Letters to a Young Poet" },
  { text: "If more of us valued food and cheer and song above hoarded gold, it would be a merrier world.", by: "J. R. R. Tolkien", in: "The Hobbit" },
  { text: "There are no ordinary people. You have never talked to a mere mortal.", by: "C. S. Lewis", in: "The Weight of Glory" },
  { text: "Angels can fly because they take themselves lightly.", by: "G. K. Chesterton", in: "Orthodoxy" },
  { text: "To be trusted is a greater compliment than to be loved.", by: "George MacDonald", in: "The Marquis of Lossie" },
  { text: "The Road goes ever on and on, down from the door where it began.", by: "J. R. R. Tolkien", in: "The Fellowship of the Ring" },
  { text: "Further up and further in!", by: "C. S. Lewis", in: "The Last Battle" },
  { text: "Very little is needed to make a happy life.", by: "Marcus Aurelius", in: "Meditations" },
  { text: "Faithless is he that says farewell when the road darkens.", by: "J. R. R. Tolkien", in: "The Fellowship of the Ring" },
]

const DAY = 86_400_000

export function quoteOf(now: number): Quote {
  const day = Math.floor((now - new Date(now).getTimezoneOffset() * 60_000) / DAY)
  return QUOTES[((day % QUOTES.length) + QUOTES.length) % QUOTES.length]!
}

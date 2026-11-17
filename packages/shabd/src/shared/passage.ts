/**
 * Finding the passage a search result matched in the page it came from.
 *
 * A result names a section by its heading, and holds the passage as the index
 * has it: plain text, cut out of the section about 200 words at a time. The
 * page has no element for a passage, so the passage is found by its words.
 *
 * There is no DOM in this file. The page hands in the words it shows
 * (src/client/search/passage.ts), which keeps this testable without a browser.
 */

/** What a search result hands to the page it leads to. */
export interface PassageTarget {
  /** The passage as the index holds it. */
  text: string
  /** The words to mark in it: see `wordsToMark`. */
  words: string[]
}

/** A passage is about 200 words. This is for the odd section that is one unbroken run of text. */
const MAX_TEXT = 4000

export function passageTarget(text: string, words: string[]): PassageTarget {
  return { text: text.slice(0, MAX_TEXT), words }
}

/** What a word that only one side has takes off the score. A word both have adds one. */
const SKIP = 0.25
/** The share of the passage that has to be found before the place is believed. */
const AGREEMENT = 1 / 3

/**
 * Where a passage sits among the words of its section, as the first and the
 * last word it covers. Null when the section does not hold it.
 *
 * The passage is not looked for as one string, because the page and the
 * index do not agree word for word. The page shows words the index never
 * saw (the label of a code block, the title of a callout), and leaves out
 * some it did (the code of a live sandbox sits in a text field). What is
 * looked for is the stretch of the section that has the most of the
 * passage's words in the passage's order, where a word that only one of the
 * two has costs a little and does not end the stretch. This is local
 * sequence alignment (Smith and Waterman), on words in place of letters.
 *
 * It takes time in proportion to the two lengths multiplied. Measured in
 * Node for a passage of 200 words: 1 ms in a section of 500 words, 4 ms in
 * one of 5,000, and 38 ms in one of 50,000.
 */
export function locatePassage(
  section: readonly string[],
  passage: readonly string[],
): { first: number; last: number } | null {
  if (section.length === 0 || passage.length === 0) return null

  // Numbers compare faster than strings, and every word is compared with every other.
  const numbers = new Map<string, number>()
  const numbered = (words: readonly string[]) =>
    Int32Array.from(words, (word) => {
      let number = numbers.get(word)
      if (number === undefined) numbers.set(word, (number = numbers.size))
      return number
    })
  const across = numbered(section)
  const down = numbered(passage)

  // One row per word of the passage. A cell holds the best score of a stretch that ends at that word of the
  // section, and where that stretch began. Only the row above is needed to fill a row in.
  const width = across.length + 1
  let scoreAbove = new Float32Array(width)
  let startAbove = new Int32Array(width)
  let score = new Float32Array(width)
  let start = new Int32Array(width)
  let best = { score: 0, first: 0, last: 0 }

  for (const word of down) {
    for (let at = 1; at < width; at++) {
      let here = 0
      let began = at - 1
      if (across[at - 1] === word) {
        here = scoreAbove[at - 1]! + 1
        if (scoreAbove[at - 1]! > 0) began = startAbove[at - 1]!
      }
      // A word of the passage that the page does not show.
      if (scoreAbove[at]! - SKIP > here) {
        here = scoreAbove[at]! - SKIP
        began = startAbove[at]!
      }
      // A word on the page that the index never saw.
      if (score[at - 1]! - SKIP > here) {
        here = score[at - 1]! - SKIP
        began = start[at - 1]!
      }
      score[at] = here
      start[at] = began
      if (here > best.score) best = { score: here, first: began, last: at - 1 }
    }
    ;[scoreAbove, score] = [score, scoreAbove]
    ;[startAbove, start] = [start, startAbove]
  }

  return best.score >= passage.length * AGREEMENT ? { first: best.first, last: best.last } : null
}

/**
 * How far apart two words are, in edits.
 *
 * Used where someone may have mistyped: a key in the YAML ("did you mean
 * `badge`?") and a word in a search. It runs in Node and in the browser.
 */

/**
 * Three rows of the table are enough: the one being filled in, the one above
 * it, and the one above that, which a swap reaches back to. They are kept
 * between calls, because a search measures one word against every word of
 * the index: with rows made afresh each time, and letters compared as
 * strings, 30,000 words took 8 ms where this takes 2.
 */
let rows = [new Uint16Array(64), new Uint16Array(64), new Uint16Array(64)]

/**
 * Edit distance where swapping two adjacent letters counts as one edit
 * (optimal string alignment). Swaps are the most common typo: `bagde`.
 *
 * `limit` is for a caller that only asks whether two words are close. The
 * count stops as soon as it is certain to pass the limit, and the answer is
 * then `limit + 1`, not the distance.
 */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  if (b.length >= rows[0]!.length) rows = rows.map(() => new Uint16Array(2 * (b.length + 1)))
  let [above2, above, row] = rows as [Uint16Array, Uint16Array, Uint16Array]
  for (let j = 0; j <= b.length; j++) above[j] = j

  for (let i = 1; i <= a.length; i++) {
    const letter = a.charCodeAt(i - 1)
    row[0] = i
    let least = i
    for (let j = 1; j <= b.length; j++) {
      const other = b.charCodeAt(j - 1)
      let best = Math.min(above[j]! + 1, row[j - 1]! + 1, above[j - 1]! + (letter === other ? 0 : 1))
      if (i > 1 && j > 1 && letter === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === other) {
        best = Math.min(best, above2[j - 2]! + 1)
      }
      row[j] = best
      if (best < least) least = best
    }
    // Every later row is built on this one, and no cell of it can come out lower than this row's least.
    if (least > limit) return limit + 1
    ;[above2, above, row] = [above, row, above2]
  }
  return Math.min(above[b.length]!, limit + 1)
}

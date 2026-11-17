/**
 * Draws the Shabd logo files: a faceted parrot chick perched on the
 * shirorekha, the headline bar that a word hangs from in Devanagari.
 *
 *     node scripts/logo/make-logo.mjs          write every file to its place in the repository
 *     node scripts/logo/make-logo.mjs <dir>    write them all into <dir> instead, to look at first
 *
 * The chick is defined once, as polygons about its perch point (x = 0 is its
 * centre line, y = 0 the top of the bar), and placed at whatever size a file
 * needs. It is marigold on a light background and indigo on a dark one.
 *
 * The README logo and the chick on the docs home page move. That is CSS
 * inside the SVG: it runs when the file is shown as an image, and it is
 * switched off for readers who ask for reduced motion. The icon, the header
 * mark and the favicon are still.
 *
 * word.json holds the outline of "shabd" set in Anek Latin at a font size of
 * 100, so the logo renders the same where the font is not installed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const word = JSON.parse(readFileSync(path.join(here, 'word.json'), 'utf8'))
const previewDir = process.argv[2]

/* ───────────── colours: [from, to] of each facet's gradient ───────────── */

const INDIGO_TUFT = { tuftL: ['#4d5ad6', '#2b36a8'], tuftR: ['#6f7beb', '#4d5ad6'] }
const ORANGE = {
  beakL: ['#ff9a52', '#f26a1b'], beakR: ['#f26a1b', '#cf4f0c'], beakLow: ['#c94c0c', '#a13a07'],
  footL: ['#ff9a52', '#f26a1b'], footR: ['#f26a1b', '#cf4f0c'],
}
const GOLD = {
  beakL: ['#ffd96b', '#ffc53d'], beakR: ['#ffb02e', '#f08a1c'], beakLow: ['#e58a1e', '#c46d0e'],
  footL: ['#ffd96b', '#ffc53d'], footR: ['#ffb02e', '#f08a1c'],
}

/** On a light background: a marigold chick with an indigo tuft, beside indigo ink. */
const LIGHT = {
  stroke: '#1b1c3a', eye: '#1b1c3a',
  ink: ['#1b1c3a', '#2b36a8'],
  capL: ['#ffc53d', '#f29d0c'], capR: ['#ffdf7a', '#ffc53d'],
  faceL: ['#fffdf5', '#fff0c2'], faceR: ['#fff3cf', '#ffe29a'], blush: ['#ffb199', '#ff8a70'],
  bodyL: ['#ffc53d', '#ee960a'], bodyR: ['#ffd966', '#f6b40e'], belly: ['#fffaf0', '#ffe9b0'],
  wingL: ['#f29d0c', '#d97c06'], wingR: ['#f6b40e', '#e08a08'],
  tailL: ['#e08a08', '#c56f05'], tailR: ['#f29d0c', '#d97c06'],
  ...INDIGO_TUFT, ...ORANGE,
  say: ['#6f7beb', '#3944b8'],
}
/** On a dark background: an indigo chick with a marigold tuft, beside pale ink. */
const DARK = {
  stroke: '#1d2063', eye: '#14163f',
  ink: ['#e8e9f5', '#b3bbff'],
  capL: ['#6b78ea', '#4654cf'], capR: ['#8f9af5', '#6b78ea'],
  faceL: ['#ffffff', '#e4e8fb'], faceR: ['#e4e8fb', '#bcc5f5'], blush: ['#ffc9a3', '#ff9f7a'],
  bodyL: ['#a4adfa', '#808cf0'], bodyR: ['#bcc3fd', '#9aa4f6'], belly: ['#ffffff', '#d6dcfa'],
  wingL: ['#5560d6', '#3a44b4'], wingR: ['#7480ea', '#5560d6'],
  tailL: ['#5560d6', '#3a44b4'], tailR: ['#7480ea', '#5560d6'],
  tuftL: GOLD.beakL, tuftR: GOLD.beakR, ...GOLD,
  say: GOLD.beakL,
}
/** For the favicon's indigo tile: the marigold chick, with a pale tuft so it shows against the tile. */
const ON_TILE = { ...LIGHT, tuftL: ['#ffffff', '#dfe4fb'], tuftR: ['#eef0fd', '#c3cbf7'] }

/* ───────────── the chick: [colour, polygon] facets, drawn in this order ───────────── */

const mirror = (points) => points.map(([x, y]) => [-x, y])
const both = (left, right, points) => [[left, points], [right, mirror(points)]]

/** A short fan. It hangs behind the bar, so it starts below the bar's top edge. */
const TAIL = [
  ['tailL', [[-14, 6], [0, 6], [0, 34], [-9, 29], [-15, 18]]],
  ['tailR', [[0, 6], [14, 6], [15, 18], [9, 29], [0, 34]]],
]
/** Each wing has the point it turns about, and how far it turns, when it flaps. */
const WINGS = [
  { fill: 'wingL', points: [[-25, -32], [-40, -29], [-48, -19], [-42, -8], [-28, -11]], pivot: [-27, -24], flap: 30 },
  { fill: 'wingR', points: mirror([[-25, -32], [-40, -29], [-48, -19], [-42, -8], [-28, -11]]), pivot: [27, -24], flap: -30 },
]
const BODY = [
  ...both('bodyL', 'bodyR', [[-24, -36], [0, -36], [0, 0], [-18, 0], [-29, -8], [-31, -21]]),
  ['belly', [[-13, -30], [13, -30], [19, -15], [11, -4], [-11, -4], [-19, -15]]],
]
/** Body colour under the head, so that no gap opens when the head moves. */
const NECK = [[-26, -44], [26, -44], [24, -30], [-24, -30]]
/** Tuft feathers, each with its pivot and how far it turns when the tuft fans out. */
const TUFT = [
  { fill: 'tuftL', points: [[-4, -96], [-9, -106], [-20, -113], [-16, -101], [-12, -94]], pivot: [-8, -95], turn: -15 },
  { fill: 'tuftR', points: mirror([[-4, -96], [-9, -106], [-20, -113], [-16, -101], [-12, -94]]), pivot: [8, -95], turn: 15 },
  { fill: 'tuftL', points: [[-5, -96], [-4, -110], [0, -121], [4, -110], [5, -96]], pivot: [0, -96], turn: 0 },
]
const HEAD = [
  ...both('capL', 'capR', [[0, -99], [-14, -98], [-27, -92], [-37, -81], [-42, -66], [0, -72]]),
  ...both('faceL', 'faceR', [[-42, -66], [0, -72], [0, -31], [-15, -31], [-29, -36], [-39, -48]]),
  ...both('blush', 'blush', [[-34, -44], [-28, -49], [-22, -44], [-28, -39]]),
]
const BEAK_LOWER = [['beakLow', [[-4, -47], [4, -47], [0, -41]]]]
const BEAK = [
  ['beakL', [[-7, -52], [0, -58], [0, -45]]],
  ['beakR', [[0, -58], [7, -52], [0, -45]]],
]
/** Two toes a foot. They reach below y = 0: the feet grip the bar. */
const FEET = [
  ['footL', [[-16, -3], [-11, -3], [-10, 8], [-17, 8]]],
  ['footR', [[-10, -3], [-5, -3], [-4, 8], [-11, 8]]],
  ['footL', mirror([[-10, -3], [-5, -3], [-4, 8], [-11, 8]])],
  ['footR', mirror([[-16, -3], [-11, -3], [-10, 8], [-17, 8]])],
]
const EYES = [[-18, -57], [18, -57]]
const EYE_RADIUS = 7.6
const NECK_PIVOT = [0, -34]
const TAIL_PIVOT = [0, 8]
/** The top of the tuft, and the reach of a wing: what a drawing has to leave room for. */
const TOP = 121
const REACH = 48

/** What the chick says: three marks that fan out from the beak, clear of the head. */
const SPEECH = [10, 28, 46].map((degrees) => {
  const angle = (degrees * Math.PI) / 180
  const out = [Math.cos(angle), -Math.sin(angle)]
  const across = [-out[1], out[0]]
  const point = (distance, aside = 0) => [out[0] * distance + across[0] * aside, -52 + out[1] * distance + across[1] * aside]
  return { points: [point(56), point(62.5, 4.4), point(72), point(62.5, -4.4)], out }
})

/* ───────────── drawing ───────────── */

const n = (value) => String(Math.round(value * 100) / 100)

function gradients(palette, prefix) {
  return Object.entries(palette)
    .filter(([, value]) => Array.isArray(value))
    .map(([name, [from, to]]) => {
      // the ink runs left to right along the bar and the word, a facet's colour corner to corner
      const y2 = name === 'ink' ? 0 : 1
      return `<linearGradient id="${prefix}-${name}" x1="0" y1="0" x2="1" y2="${y2}"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
    })
    .join('\n    ')
}

/**
 * The chick at a place and size, as SVG fragments to stack around a bar.
 * `side` is where it leans and speaks: 1 to the right of the picture, -1 to the left.
 */
function placed(palette, prefix, cx, perch, k, { outlined = true, side = 1 } = {}) {
  const at = ([x, y]) => [cx + x * k, perch + y * k]
  const outline = outlined
    ? ` stroke="${palette.stroke}" stroke-width="${n(1.5 * Math.max(k, 0.6))}" stroke-linejoin="round"`
    : ''
  const d = (points) => points.map((point, i) => `${i ? 'L' : 'M'}${at(point).map(n).join(' ')}`).join('') + 'Z'
  const facet = ([fill, points], attributes = '') =>
    `<path${attributes} d="${d(points)}" fill="url(#${prefix}-${fill})"${outline}/>`
  const facets = (list) => list.map((item) => facet(item)).join('\n      ')
  const each = (list, name) =>
    list.map((part, index) => facet([part.fill, part.points], ` class="sb-${name} sb-${name}-${index}"`)).join('\n      ')

  const eye = (centre, index) => {
    const [x, y] = at(centre)
    const [gx, gy] = at([centre[0] + 2.2, centre[1] - 2.4])
    return `<g class="sb-eye sb-eye-${index}"><circle cx="${n(x)}" cy="${n(y)}" r="${n(EYE_RADIUS * k)}" fill="${palette.eye}"/><circle cx="${n(gx)}" cy="${n(gy)}" r="${n(EYE_RADIUS * 0.32 * k)}" fill="#ffffff"/></g>`
  }
  // hidden until the animation shows them, so a renderer that does not animate draws a quiet chick
  const speech = SPEECH.map(({ points }, index) =>
    facet(['say', points.map(([x, y]) => [x * side, y])], ` class="sb-say sb-say-${index}" opacity="0"`),
  ).join('\n      ')

  return {
    at,
    k,
    side,
    tail: `<g class="sb-tail">\n      ${facets(TAIL)}\n    </g>`,
    body: [
      `<g>\n      ${each(WINGS, 'wing')}\n      ${facets(BODY)}\n      <path d="${d(NECK)}" fill="url(#${prefix}-bodyL)"/>\n    </g>`,
      `<g class="sb-head">\n      ${each(TUFT, 'tuft')}\n      ${facets(HEAD)}\n      <g class="sb-beak-lower">${facets(BEAK_LOWER)}</g>\n      ${facets(BEAK)}\n      ${EYES.map(eye).join('\n      ')}\n    </g>`,
    ].join('\n    '),
    feet: `<g>\n      ${facets(FEET)}\n    </g>`,
    speech: `<g>\n      ${speech}\n    </g>`,
  }
}

/**
 * How the chick moves. It hops once. Then, every ten seconds: it cocks its
 * head and fans its tuft, settles, and says something, flapping as it does.
 * It blinks and its tail sways on clocks of their own, so the loop does not
 * look like one.
 */
const HOP = 11 // how high it hops; a drawing that moves needs this much room above the tuft
function motion(bird) {
  const { k, side } = bird
  const px = (point) => bird.at(point).map((value) => `${n(value)}px`).join(' ')
  const u = (units) => `${n(units * k)}px`
  const rules = [
    // The hop starts and ends in the resting pose, so whatever shows only the first frame shows the whole logo.
    `.sb-hop { transform-origin: ${px([0, 0])}; animation: sb-hop 0.8s ease-out 0.4s 1; }`,
    `@keyframes sb-hop { 0%, 100% { transform: translateY(0px) scale(1, 1); } 30% { transform: translateY(${u(-HOP)}) scale(1, 1); } 56% { transform: translateY(0px) scale(1.05, 0.93); } 76% { transform: translateY(0px) scale(0.99, 1.02); } }`,

    `.sb-head { transform-origin: ${px(NECK_PIVOT)}; animation: sb-head 10s ease-in-out infinite; }`,
    `@keyframes sb-head { 0%, 30%, 62%, 70%, 76%, 82%, 88%, 100% { transform: rotate(0deg) translateY(0px); } 37%, 56% { transform: rotate(${9 * side}deg) translateY(0px); } 73%, 79%, 85% { transform: rotate(0deg) translateY(${u(-2)}); } }`,
    ...TUFT.flatMap((feather, index) => [
      `.sb-tuft-${index} { transform-origin: ${px(feather.pivot)}; animation: sb-tuft-${index} 10s ease-in-out infinite; }`,
      `@keyframes sb-tuft-${index} { 0%, 30%, 62%, 100% { transform: rotate(0deg); } 38%, 54% { transform: rotate(${feather.turn}deg); } }`,
    ]),

    ...EYES.map((eye, index) => `.sb-eye-${index} { transform-origin: ${px(eye)}; }`),
    `.sb-eye { animation: sb-blink 4.6s linear infinite; }`,
    `@keyframes sb-blink { 0%, 92%, 98%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.08); } }`,

    `.sb-tail { transform-origin: ${px(TAIL_PIVOT)}; animation: sb-sway 5s ease-in-out infinite; }`,
    `@keyframes sb-sway { 0%, 50%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-3deg); } 75% { transform: rotate(3deg); } }`,

    ...WINGS.flatMap((wing, index) => [
      `.sb-wing-${index} { transform-origin: ${px(wing.pivot)}; animation: sb-wing-${index} 10s ease-in-out infinite; }`,
      `@keyframes sb-wing-${index} { 0%, 70%, 88%, 100% { transform: rotate(0deg); } 73%, 79%, 85% { transform: rotate(${wing.flap}deg); } 76%, 82% { transform: rotate(${n(wing.flap * 0.25)}deg); } }`,
    ]),
    `.sb-beak-lower { animation: sb-beak 10s linear infinite; }`,
    `@keyframes sb-beak { 0%, 70%, 88%, 100% { transform: translateY(0px); } 73%, 79%, 85% { transform: translateY(${u(2.5)}); } 76%, 82% { transform: translateY(${u(0.6)}); } }`,
    ...SPEECH.flatMap(({ out }, index) => {
      const move = (units) => `translate(${u(out[0] * side * units)}, ${u(out[1] * units)})`
      return [
        `.sb-say-${index} { animation: sb-say-${index} 10s ease-out ${n(index * 0.22)}s infinite; }`,
        `@keyframes sb-say-${index} { 0%, 71%, 90%, 100% { opacity: 0; transform: ${move(-4)}; } 76% { opacity: 1; } 84% { opacity: 1; } 89% { opacity: 0; transform: ${move(8)}; } }`,
      ]
    }),

    `@media (prefers-reduced-motion: reduce) { .sb-hop, .sb-head, .sb-tuft, .sb-eye, .sb-tail, .sb-wing, .sb-beak-lower, .sb-say { animation: none; } }`,
  ]
  return `<style>\n    ${rules.join('\n    ')}\n  </style>`
}

const svg = (width, height, defs, body, label) =>
  `<svg width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">\n  <defs>\n    ${defs}\n  </defs>\n  ${body.join('\n  ')}\n</svg>\n`

const bar = (prefix, x1, x2, y, thickness) =>
  `<rect x="${n(x1)}" y="${n(y)}" width="${n(x2 - x1)}" height="${n(thickness)}" fill="url(#${prefix}-ink)"/>`

const hop = (...parts) => `<g class="sb-hop">\n    ${parts.join('\n    ')}\n  </g>`

/* ───────────── the files ───────────── */

/** The logo: the chick on the bar at the left, the word hanging from the bar beside it. It moves. */
function logo(palette, prefix) {
  const k = 1.32
  const perch = Math.ceil((TOP + HOP) * k) + 6
  const thickness = 18
  const scale = 1.12 // of the word, which was outlined at a font size of 100
  const cx = 14 + Math.ceil(REACH * k) + 6
  const wordLeft = cx + Math.ceil(REACH * k) + 22
  const baseline = perch + thickness - word.top * scale // ascenders touch the underside of the bar
  const wordRight = wordLeft + word.advance * scale
  const bird = placed(palette, prefix, cx, perch, k)
  return svg(
    Math.ceil(wordRight + 16),
    Math.ceil(baseline + word.bottom * scale + 14),
    gradients(palette, prefix),
    [
      motion(bird),
      hop(bird.tail),
      bar(prefix, 14, wordRight - 4, perch, thickness),
      `<path transform="translate(${n(wordLeft)} ${n(baseline)}) scale(${n(scale)})" d="${word.d}" fill="url(#${prefix}-ink)"/>`,
      hop(bird.body, bird.feet, bird.speech),
    ],
    'Shabd',
  )
}

/** The icon: the chick alone on its bar, square and still. */
function icon(palette, prefix) {
  const size = 256
  const perch = 184
  const bird = placed(palette, prefix, size / 2, perch, 1.36)
  return svg(
    size,
    size,
    gradients(palette, prefix),
    [bird.tail, bar(prefix, 34, size - 34, perch, 18), bird.body, bird.feet],
    'Shabd',
  )
}

/** The mark: the chick on a short bar, cropped close, for a site header. Still, and without the tail. */
function mark(palette, prefix) {
  const width = 2 * REACH + 12
  const perch = TOP + 5
  const bird = placed(palette, prefix, width / 2, perch, 1)
  return svg(
    width,
    perch + 20,
    gradients(palette, prefix),
    [bar(prefix, 6, width - 6, perch, 16), bird.body, bird.feet],
    'Shabd',
  )
}

/**
 * The chick for a page that has a headline bar of its own. The picture has no
 * bar: from PERCHED.above down to PERCHED.above + PERCHED.gap it draws only
 * the feet, and the tail starts below that. Laid over a bar of that
 * thickness, the chick stands on it with its tail behind it. It moves, and it
 * leans and speaks to the left, so it belongs at the right-hand end of a bar.
 * docs/styles/custom.css places it by these numbers.
 */
const PERCHED = { width: 136, centre: 84, above: TOP + HOP + 4, gap: 13, below: 36 }
function perched(palette, prefix) {
  const { width, centre, above, gap, below } = PERCHED
  const height = above + below
  const bird = placed(palette, prefix, centre, above, 1, { side: -1 })
  // the tail shows above the bar (while the chick hops) and below it, never across it
  const clip = `<clipPath id="${prefix}-off-bar"><rect width="${width}" height="${above}"/><rect y="${above + gap}" width="${width}" height="${height - above - gap}"/></clipPath>`
  return svg(
    width,
    height,
    `${gradients(palette, prefix)}\n    ${clip}`,
    [
      motion(bird),
      `<g clip-path="url(#${prefix}-off-bar)">\n  ${hop(bird.tail)}\n  </g>`,
      hop(bird.body, bird.feet, bird.speech),
    ],
    'A chick',
  )
}

/** The favicon: an indigo tile with the marigold chick on a pale bar. No outlines, which blur at sixteen pixels. */
function favicon() {
  const perch = 106
  const bird = placed(ON_TILE, 'f', 64, perch, 0.8, { outlined: false })
  const tile = `<linearGradient id="f-tile" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#3944b8"/><stop offset="1" stop-color="#151849"/></linearGradient>`
  const body = [
    `<rect width="128" height="128" rx="30" fill="url(#f-tile)"/>`,
    `<rect x="18" y="${perch}" width="92" height="9" fill="#e8e9f5"/>`,
    bird.body,
    bird.feet,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n  <defs>\n    ${tile}\n    ${gradients(ON_TILE, 'f')}\n  </defs>\n  ${body.join('\n  ')}\n</svg>\n`
}

const FILES = {
  'img/shabd-logo.svg': () => logo(LIGHT, 'l'),
  'img/shabd-logo-dark.svg': () => logo(DARK, 'd'),
  'img/shabd-icon.svg': () => icon(LIGHT, 'i'),
  'img/shabd-icon-dark.svg': () => icon(DARK, 'j'),
  'docs/public/logo-light.svg': () => mark(LIGHT, 'm'),
  'docs/public/logo-dark.svg': () => mark(DARK, 'n'),
  'docs/public/bird-light.svg': () => perched(LIGHT, 'p'),
  'docs/public/bird-dark.svg': () => perched(DARK, 'q'),
  'docs/public/favicon.svg': favicon,
  'e2e/site/public/favicon.svg': favicon,
}

for (const [file, draw] of Object.entries(FILES)) {
  const target = previewDir ? path.join(previewDir, path.basename(file)) : path.join(root, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, draw())
  console.log(path.relative(process.cwd(), target))
}

if (previewDir) console.log(`perched: ${JSON.stringify({ ...PERCHED, height: PERCHED.above + PERCHED.below })}`)

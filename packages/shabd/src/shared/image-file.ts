/**
 * What the Studio takes for an image, and what it calls the file.
 *
 * An image pasted or dropped into the editor is saved beside the page. The
 * dev server decides both questions for what it is sent, and the browser
 * decides them itself before it writes into a connected folder, so the
 * answers are here, where both can read them.
 *
 * What a file is, is read from its first bytes. Its name and the type the
 * browser reports for it are only what the sender says. The name it is
 * saved under is made here, from letters, digits and hyphens and the
 * extension that goes with its content, so nothing in a name that was sent
 * can choose a folder or a kind of file.
 */

/** The largest image the Studio saves. A screenshot of a large screen is a few megabytes. */
export const IMAGE_BYTES_LIMIT = 10 * 1024 * 1024

export interface ImageKind {
  /** The extension the file gets, whatever it was called. */
  extension: 'png' | 'jpg' | 'gif' | 'webp' | 'avif'
}

const KINDS = {
  png: { extension: 'png' },
  jpg: { extension: 'jpg' },
  gif: { extension: 'gif' },
  webp: { extension: 'webp' },
  avif: { extension: 'avif' },
} satisfies Record<string, ImageKind>

/** What is said when a file is turned away, by the dev server and by the browser alike. */
export const NOT_AN_IMAGE = 'That file is not a PNG, JPEG, GIF, WebP or AVIF image.'
export const IMAGE_TOO_LARGE = `That image is larger than ${IMAGE_BYTES_LIMIT / 1024 / 1024} MB.`
export const TOO_MANY_IMAGES = 'There are too many images with that name beside the page.'

/** How many names are tried before giving up: `shot.png`, `shot-2.png` and so on. */
export const IMAGE_NAME_ATTEMPTS = 200

const ascii = (bytes: Uint8Array, from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length))

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte)

/**
 * The kind of image these bytes are, by how such a file begins. Undefined
 * for anything else, an SVG among them: that is text, it can carry a
 * script, and there is no telling one from its first bytes.
 */
export function sniffImage(bytes: Uint8Array): ImageKind | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return KINDS.png
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return KINDS.jpg
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return KINDS.gif
  // A RIFF file says what it holds in its ninth to twelfth byte. Sound and video are RIFF files too.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return KINDS.webp
  // AVIF is one of a family that starts with a box called `ftyp`, which lists the brands the file is.
  // MP4 video and HEIC pictures are of the family as well, so the list has to name AVIF.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const size = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)
    const end = Math.min(size, bytes.length, 64)
    for (let at = 8; at + 4 <= end; at += at === 8 ? 8 : 4) {
      const brand = ascii(bytes, at, 4)
      if (brand === 'avif' || brand === 'avis') return KINDS.avif
    }
  }
  return undefined
}

/** The longest name, before the extension. */
const LONGEST_NAME = 60

/**
 * The name an image is saved under: what it was called, in lower case, with
 * everything but letters and digits turned into hyphens, and the extension
 * of what it is. An `attempt` after the first is for when the name is taken:
 * `shot.png`, `shot-2.png`, `shot-3.png`.
 */
export function imageFileName(suggested: unknown, kind: ImageKind, attempt = 1): string {
  const given = typeof suggested === 'string' ? suggested : ''
  // Only the last part of a path, and not its extension: `../Shot 1.jpeg` is `shot-1`.
  const last = given.split(/[\\/]/).pop() ?? ''
  const stem = last.replace(/\.[^.]*$/, '')
  const base =
    stem
      // An accented letter becomes the letter: `é` is `e`.
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, LONGEST_NAME)
      .replace(/-+$/, '') || 'image'
  // Windows keeps a few names for devices, whatever the extension.
  const name = /^(?:con|prn|aux|nul|com\d|lpt\d)$/.test(base) ? `image-${base}` : base
  return `${name}${attempt > 1 ? `-${attempt}` : ''}.${kind.extension}`
}

/** The Markdown that shows an image saved beside a page. The alternative text is left for the author to write. */
export function imageMarkdown(fileName: string): string {
  return `![](./${fileName})`
}

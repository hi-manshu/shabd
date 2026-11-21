/**
 * What a page and the frame of an isolated snippet say to each other.
 *
 * The frame has an origin of its own, so the two share nothing and can only
 * post messages. Every message carries a mark saying which side sent it, and
 * each side also checks the window a message came from.
 */

/** Marks a message from the page to a frame, and from a frame to the page. */
export const FROM_PAGE = 'shabd:page'
export const FROM_FRAME = 'shabd:frame'

/** A stylesheet of the page: its text, or its address where the page may not read the text. */
export type Sheet = { css: string } | { href: string; media?: string }

/** How the page looks: what is on its root element, and its stylesheets in order. */
export interface Look {
  attributes: Record<string, string>
  sheets: Sheet[]
}

/** A font the page has loaded, as its bytes: the frame may not fetch the file itself. */
export interface FrameFont {
  family: string
  source: ArrayBuffer
  descriptors: FontFaceDescriptors
}

export type ToFrame =
  /** The script the frame runs, in answer to `boot`. */
  | { type: 'boot'; code: string }
  /** A snippet as a script, and the shared state as it stands. `run` numbers the attempt. */
  | { type: 'run'; run: number; code: string; needs: string[]; state: [string, unknown][] }
  | { type: 'state'; state: [string, unknown][] }
  | { type: 'look'; look: Look }
  | { type: 'fonts'; fonts: FrameFont[] }

export type ToPage =
  /** The frame's document has loaded and wants its script. */
  | { type: 'boot' }
  /** The script is running and can take a snippet. */
  | { type: 'ready' }
  /** The snippet of that run is on the screen. */
  | { type: 'shown'; run: number }
  | { type: 'error'; run: number; message: string }
  /** How tall the frame's content is, in CSS pixels. */
  | { type: 'height'; height: number }
  /** The snippet set a shared value. */
  | { type: 'set'; key: string; value: unknown }

/**
 * The frame's document before its script arrives. It asks the page for the
 * script and runs what the page answers with. The script is not written into
 * this text: code can hold `</script>`, and a document that grew with every
 * module would be parsed again for each frame.
 *
 * Without `allow-same-origin` the frame cannot read the page, its cookies or
 * its storage, and without `allow-top-navigation` it cannot send the reader
 * elsewhere.
 */
export function frameDocument(base: string, lang: string): string {
  const boot = `addEventListener("message",function boot(e){if(e.source!==parent||!e.data||e.data.shabd!==${JSON.stringify(FROM_PAGE)}||e.data.type!=="boot")return;removeEventListener("message",boot);(0,eval)(e.data.code)});parent.postMessage({shabd:${JSON.stringify(FROM_FRAME)},type:"boot"},"*")`
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return [
    '<!doctype html>',
    `<html lang="${escape(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    // Addresses in a snippet are read as they would be in the page. A link opens nothing: the frame may not.
    `<base href="${escape(base)}">`,
    // After the page's stylesheets, which the script puts before this one.
    '<style id="sb-frame">',
    // The colour the stage behind the frame is drawn in, once the page's styles are here to name it. A
    // frame that only let that colour show through would have text on no colour of its own.
    'html, body { background: var(--sb-background, transparent) !important; margin: 0 !important; min-block-size: 0 !important; block-size: auto !important; }',
    'body { padding: 1rem !important; overflow: hidden !important; }',
    '#root > :first-child { margin-block-start: 0; }',
    '#root > :last-child { margin-block-end: 0; }',
    '</style>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script>${boot}</script>`,
    '</body>',
    '</html>',
  ].join('\n')
}

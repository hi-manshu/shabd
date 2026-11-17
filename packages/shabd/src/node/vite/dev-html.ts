/**
 * Keeps the site's base path from being written twice in `shabd dev`.
 *
 * The page document has the base on its own addresses already: it is the same
 * text a build writes. Vite's dev server does not expect that. It puts the
 * base in front of every address in a document that starts with one slash, so
 * `/docs/favicon.svg` left it as `/docs/docs/favicon.svg`. The script that
 * starts the app was asked for at an address where nothing is, and a site with
 * a `site.base` showed an empty page in dev.
 *
 * Two hooks, one on each side of Vite's own. The first writes those addresses
 * in a way Vite leaves alone; the second writes them back. Whatever the
 * document holds, now or later, comes out as it went in.
 */
import type { Plugin } from 'vite'

/**
 * Stands where the base was. An address that starts with two slashes names a
 * host, and Vite does not touch those. `.invalid` is a name no host can have.
 */
const HIDDEN = '//shabd-base.invalid/'

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The document with every attribute that starts with the base starting with the stand-in instead. */
export function hideBase(html: string, base: string): string {
  if (base === '/') return html
  return html.replace(new RegExp(`(\\s[\\w:-]+=["'])${escaped(base)}`, 'g'), `$1${HIDDEN}`)
}

export function restoreBase(html: string, base: string): string {
  return base === '/' ? html : html.split(HIDDEN).join(base)
}

export function keepBase(base: () => string): Plugin[] {
  return [
    {
      name: 'shabd:hide-base',
      apply: 'serve',
      transformIndexHtml: { order: 'pre', handler: (html) => hideBase(html, base()) },
    },
    {
      name: 'shabd:restore-base',
      apply: 'serve',
      transformIndexHtml: { order: 'post', handler: (html) => restoreBase(html, base()) },
    },
  ]
}

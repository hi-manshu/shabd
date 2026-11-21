/**
 * Turns compiler output into the module a route loads.
 *
 * On top of the MDX component (the default export) a page module exports
 * what the layout engine needs to render it: validated `frontmatter`, the
 * `toc`, and `codeCss`, the colours of its code. They travel with the
 * content, so when a page hot-updates, its layout, table of contents, body
 * and code colours all change in the same frame.
 */
import type { Frontmatter } from '../../shared/schema.js'
import type { PageUpdated } from '../../shared/types.js'
import { codeFrame, type ShabdError } from '../config/errors.js'
import type { CompiledPage } from './compile.js'

/** Resolved by the Vite plugin to the client's page-update hub. */
export const HMR_RUNTIME_ID = 'virtual:shabd/hmr'
/** Resolved by the Vite plugin to the component that shows a page's error in place. */
export const PAGE_ERROR_ID = 'virtual:shabd/page-error'

export function toPageModule(
  compiled: CompiledPage,
  frontmatter: Frontmatter,
  /** Page id to register for hot updates. Omit in production builds. */
  hotId?: string,
  /** The day the page was last changed, when the site shows it. */
  updated?: PageUpdated,
  /**
   * The page's code colours under the themes of the theme menu, as a
   * stylesheet. The dev server gives it, so that each page is whole on its
   * own. A build leaves it out: there one stylesheet holds them for the site.
   */
  themedCodeCss = '',
): string {
  let code = compiled.code
  code += `\nexport const frontmatter = ${JSON.stringify(frontmatter)};`
  code += `\nexport const toc = ${JSON.stringify(compiled.toc)};`
  code += `\nexport const codeCss = ${JSON.stringify(compiled.codeCss + themedCodeCss)};\n`
  if (updated) code += `export const updated = ${JSON.stringify(updated)};\n`

  if (hotId !== undefined) {
    // The module accepts its own updates and hands the new version to the
    // router, which swaps it in without remounting the layout around it.
    code +=
      `import { acceptPage as __shabdAccept } from ${JSON.stringify(HMR_RUNTIME_ID)};\n` +
      `if (import.meta.hot) {\n` +
      `  import.meta.hot.accept((next) => { if (next) __shabdAccept(${JSON.stringify(hotId)}, next) });\n` +
      `}\n`
  }
  return code
}

/**
 * The module served in dev for a page that does not compile.
 *
 * A broken page still has to be a valid module. If its import failed, the
 * dev client could only discard the update (or reload into a blank page),
 * and someone typing in the Studio would lose their place over a half-typed
 * line. Instead the page renders its own error where its content would be,
 * inside its usual layout, and hot-updates back when the file is fixed.
 */
export function toErrorModule(error: ShabdError, displayFile: string, frontmatter: Frontmatter, hotId: string): string {
  const issues = error.issues.map((issue) => ({
    message: issue.message,
    where: issue.line !== undefined ? `${displayFile}:${issue.line}:${issue.column ?? 1}` : displayFile,
    frame: error.source && issue.line !== undefined ? codeFrame(error.source, issue.line, issue.column ?? 1, false) : '',
  }))
  const code =
    `import { createElement as __shabdElement } from 'react';\n` +
    `import { PageError as __ShabdPageError } from ${JSON.stringify(PAGE_ERROR_ID)};\n` +
    `const __shabdIssues = ${JSON.stringify(issues)};\n` +
    `export default function PageWithError() {\n` +
    `  return __shabdElement(__ShabdPageError, { issues: __shabdIssues });\n` +
    `}\n`
  const nothing = { toc: [], sections: [], links: [], linkLines: [], external: [], unlabelled: [], strays: [], snippets: [], anchors: [], codeCss: '', codeColours: {} }
  return toPageModule({ code, ...nothing }, frontmatter, hotId)
}

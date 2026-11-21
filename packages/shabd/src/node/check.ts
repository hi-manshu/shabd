/**
 * `shabd check`: everything that can be wrong with a site, found without
 * building it. The build runs the same checks and reports them as warnings.
 *
 * What is plainly wrong is always an error: a link to a page that is not
 * there, a redirect that leads nowhere. What is a matter of the site's own
 * standards (a picture with no alternative text, a page with no
 * description, a link to another site that does not answer) is as serious
 * as `check:` in the config says, and can be switched off.
 */
import path from 'node:path'
import pc from 'picocolors'
import type { CheckLevel } from '../shared/schema.js'
import { SNIPPET_MODULES, SnippetError, transformSnippet } from '../shared/snippet.js'
import { checkExternalLinks, type ExternalOptions } from './check-external.js'
import { isShabdError, type ShabdError } from './config/errors.js'
import { redirectRoute } from './config/load.js'
import { compilePage, createContext, type ShabdContext } from './context.js'

export type ProblemLevel = Exclude<CheckLevel, 'off'>

export interface Problem {
  level: ProblemLevel
  /** Which check found it: `link`, `redirect`, `sidebar`, `variable`, `alt-text`, `description`, `external-link`, `openapi`, `snippet`. */
  rule: string
  /** File the problem is in, relative to the site root. */
  file: string
  line?: number | undefined
  message: string
}

export interface CheckResult {
  problems: Problem[]
  /** Errors that carry their own code frame (invalid frontmatter, MDX syntax). */
  detailed: ShabdError[]
}

export interface CheckOptions {
  /** Ask the links that leave the site whether they answer, whatever `check.externalLinks` says. */
  external?: boolean
  /** How the links that leave the site are asked. For tests. */
  network?: ExternalOptions
}

/** How many notes about one OpenAPI description are given in full. */
const MOST_NOTES = 12

/** Compile every page and collect problems with content, navigation and links. */
export async function collectProblems(context: ShabdContext, options: CheckOptions = {}): Promise<CheckResult> {
  const { config, store } = context
  const rules = config.config.check
  const relative = (file: string) => path.relative(config.root, file)
  const problems: Problem[] = []
  const detailed: ShabdError[] = []
  const at = (line: number | undefined) => (line ? { line } : {})

  const sidebarFile = relative(config.sidebarFile)
  for (const warning of store.sidebarWarnings()) {
    problems.push({ level: 'warning', rule: 'sidebar', file: sidebarFile, line: warning.line, message: warning.message })
  }

  // What of an OpenAPI description its pages could not show. A large description can leave hundreds of
  // these, mostly of one kind, so the first few are given and the rest counted.
  for (const api of store.apis) {
    const file = relative(api.spec)
    for (const note of api.notes.slice(0, MOST_NOTES)) problems.push({ level: 'note', rule: 'openapi', file, message: note })
    const more = api.notes.length - MOST_NOTES
    if (more > 0) {
      problems.push({ level: 'note', rule: 'openapi', file, message: `${more} more ${more === 1 ? 'part' : 'parts'} of this description could not be shown either.` })
    }
  }

  /** What a live snippet may import: what every snippet has, and what the config names. */
  const importable = new Set([...SNIPPET_MODULES, ...config.sandboxModules.map((module) => module.name)])

  // Compile everything first: links can only be checked against the full set of pages and anchors.
  const anchors = new Map<string, Set<string>>()
  const links: { file: string; target: string; line?: number }[] = []
  const external: { file: string; url: string; line?: number }[] = []
  for (const page of store.pages()) {
    const file = relative(page.file)
    // A name in braces that is nearly a variable was most likely meant to be one.
    for (const note of page.notes) {
      problems.push({ level: 'warning', rule: 'variable', file, line: note.line, message: note.message })
    }
    if (rules.descriptions !== 'off' && !page.description && !page.error) {
      problems.push({
        level: rules.descriptions,
        rule: 'description',
        file,
        message: 'This page has no description. Search results, llms.txt and links shared to other sites show one where there is one.',
      })
    }
    try {
      const compiled = await compilePage(context, page)
      anchors.set(page.path, new Set(compiled.anchors))
      compiled.links.forEach((target, index) => links.push({ file, target, ...at(compiled.linkLines[index]) }))
      for (const link of compiled.external) external.push({ file, ...link })
      for (const stray of compiled.strays) {
        problems.push({
          level: 'warning',
          rule: 'component',
          file,
          ...at(stray.line),
          message: `<${stray.name}> is written like a component, and components only work in .mdx pages. Here it is an HTML element the browser does not know. Name the file .mdx.`,
        })
      }
      // A live snippet that cannot run shows its reader an error where the example was meant to be.
      for (const snippet of compiled.snippets) {
        const problem = (message: string, line = 0) =>
          problems.push({ level: 'error', rule: 'snippet', file, ...at(snippet.line ? snippet.line + line : undefined), message })
        try {
          const { needs } = await transformSnippet(snippet.code)
          for (const name of needs) {
            if (importable.has(name)) continue
            problem(
              `This live snippet imports "${name}", and a snippet can import only what the site says it may. Name it under features.sandbox.modules in ${path.basename(config.configFile)}.`,
            )
          }
        } catch (error) {
          if (!(error instanceof SnippetError)) throw error
          // The place is given as a line of the page, so the one counted within the snippet is taken off the message.
          problem(`This live snippet cannot run: ${error.message.replace(/ \(\d+:\d+\)$/, '')}`, error.line)
        }
      }
      if (rules.altText !== 'off') {
        for (const image of compiled.unlabelled) {
          problems.push({
            level: rules.altText,
            rule: 'alt-text',
            file,
            ...at(image.line),
            message: `The picture ${image.src} has no alternative text, so it says nothing to a reader who cannot see it. Write it between the square brackets.`,
          })
        }
      }
    } catch (error) {
      if (!isShabdError(error)) throw error
      detailed.push(error)
      // Its anchors are unknown, so links into this page are not second-guessed.
      anchors.set(page.path, new Set())
    }
  }

  const moved = new Map(config.redirects.map((redirect) => [redirect.from, redirect]))

  for (const { file, target, line } of links) {
    const [route = '', fragment] = target.split('#')
    const known = anchors.get(route)
    const redirect = moved.get(route)
    const problem = (level: ProblemLevel, message: string) => problems.push({ level, rule: 'link', file, ...at(line), message })
    if (!known && redirect) {
      // The link works, by way of the redirect. It is still worth saying: the reader makes a stop they need not.
      problem('warning', `Link to ${route}, which has moved to ${redirect.to}. Link there instead.`)
    } else if (!known) {
      problem('error', `Broken link: no page at ${route}`)
    } else if (fragment && known.size > 0 && !known.has(decodeURIComponent(fragment))) {
      problem('error', `Broken link: ${route} has no heading "#${fragment}"`)
    }
  }

  const configFile = relative(config.configFile)
  for (const redirect of config.redirects) {
    const line = config.locate(['redirects', redirect.key])?.line
    const problem = (message: string) => problems.push({ level: 'error', rule: 'redirect', file: configFile, line, message })
    if (anchors.has(redirect.from)) {
      problem(`Redirect from ${redirect.from}: a page has that address, so the redirect is never used. Remove one of them.`)
    }
    if (redirect.external) continue
    const route = redirectRoute(redirect.to)
    const fragment = redirect.to.split('#')[1]
    const known = anchors.get(route)
    if (!known) {
      problem(`Redirect from ${redirect.from} leads to ${route}, where there is no page`)
    } else if (fragment && known.size > 0 && !known.has(decodeURIComponent(fragment))) {
      problem(`Redirect from ${redirect.from} leads to ${route}, which has no heading "#${fragment}"`)
    }
  }

  for (const slug of store.sidebar.unlisted) {
    problems.push({
      level: 'note',
      rule: 'sidebar',
      file: sidebarFile,
      message: `/${slug} is published but not in the sidebar. Add it, or set \`sidebar: { exclude: true }\` in its frontmatter.`,
    })
  }

  // Asked for on the command line, a link that does not answer is a warning even on a site that has the rule off.
  const externalLevel: CheckLevel = rules.externalLinks === 'off' && options.external ? 'warning' : rules.externalLinks
  if (externalLevel !== 'off' && external.length > 0) {
    const verdicts = await checkExternalLinks(
      external.map((link) => link.url),
      options.network,
    )
    for (const { file, url, line } of external) {
      const verdict = verdicts.get(url)
      if (verdict?.state === 'broken') {
        problems.push({ level: externalLevel, rule: 'external-link', file, ...at(line), message: `${url} ${verdict.detail}` })
      } else if (verdict?.state === 'unknown') {
        // Nothing is known about what a reader would get, so nothing is held against the page.
        problems.push({ level: 'note', rule: 'external-link', file, ...at(line), message: `${url} ${verdict.detail}, so it could not be checked` })
      }
    }
  }

  return { problems, detailed }
}

const LABEL = { error: pc.red('error'), warning: pc.yellow('warning'), note: pc.dim('note') }

export function formatProblem(problem: Problem): string {
  const where = problem.line !== undefined ? `${problem.file}:${problem.line}` : problem.file
  return `  ${LABEL[problem.level]}  ${pc.cyan(where)}  ${problem.message}`
}

/** How the result is printed: for a person, for a program, or for GitHub to draw beside the lines of a pull request. */
export const CHECK_FORMATS = ['text', 'json', 'github'] as const
export type CheckFormat = (typeof CHECK_FORMATS)[number]

/** Page errors (invalid frontmatter, MDX that does not parse) as problems, one for each issue. */
function fromDetailed(error: ShabdError, root: string): Problem[] {
  return error.issues.map((issue) => ({
    level: 'error' as const,
    rule: 'page',
    file: path.relative(root, error.file),
    ...(issue.line !== undefined ? { line: issue.line } : {}),
    message: issue.message,
  }))
}

/** What `--format json` prints. */
export interface CheckReport {
  pages: number
  errors: number
  warnings: number
  notes: number
  problems: Problem[]
}

export function toReport(pages: number, result: CheckResult, root: string): CheckReport {
  const problems = [...result.detailed.flatMap((error) => fromDetailed(error, root)), ...result.problems]
  const count = (level: ProblemLevel) => problems.filter((problem) => problem.level === level).length
  return { pages, errors: count('error'), warnings: count('warning'), notes: count('note'), problems }
}

/**
 * A problem as a GitHub Actions workflow command, which GitHub shows beside
 * the line in a pull request. Paths are given from the folder the command
 * runs in, which in a workflow is the root of the repository.
 */
export function githubAnnotation(problem: Problem, root: string, cwd = process.cwd()): string {
  const command = problem.level === 'note' ? 'notice' : problem.level
  // In a property a comma or a colon would end it early, and in the message a newline would.
  const property = (text: string) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C')
  const message = problem.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  const file = path.relative(cwd, path.join(root, problem.file)).split(path.sep).join('/')
  const line = problem.line !== undefined ? `,line=${problem.line}` : ''
  return `::${command} file=${property(file)}${line},title=${property(`shabd check: ${problem.rule}`)}::${message}`
}

/** Returns true when the site has no errors. */
export async function check(root: string, options: CheckOptions & { format?: CheckFormat } = {}): Promise<boolean> {
  const context = await createContext(root, { dev: false })
  const result = await collectProblems(context, options)
  await context.compiler.cache.flush()
  const report = toReport(context.store.pages().length, result, context.config.root)

  if (options.format === 'json') {
    // Nothing but the report, so that a program can read standard output as it is.
    console.log(JSON.stringify(report, null, 2))
    return report.errors === 0
  }

  if (options.format === 'github') {
    for (const problem of report.problems) console.log(githubAnnotation(problem, context.config.root))
  } else {
    for (const error of result.detailed) console.error(`\n${error.pretty(context.config.root)}`)
    if (result.problems.length) console.log(`\n${result.problems.map(formatProblem).join('\n')}`)
  }

  const pages = `${report.pages} ${report.pages === 1 ? 'page' : 'pages'}`
  console.log(
    report.errors || report.warnings
      ? `\n${pc.bold(`${pages} checked:`)} ${report.errors} ${report.errors === 1 ? 'error' : 'errors'}, ${report.warnings} ${report.warnings === 1 ? 'warning' : 'warnings'}\n`
      : `\n${pc.green('✓')} ${pages} checked, no problems found\n`,
  )
  return report.errors === 0
}

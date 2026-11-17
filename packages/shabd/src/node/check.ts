/**
 * `shabd check`: everything that can be wrong with a site, found without
 * building it. The build runs the same checks and reports them as warnings.
 */
import path from 'node:path'
import pc from 'picocolors'
import { isShabdError, type ShabdError } from './config/errors.js'
import { redirectRoute } from './config/load.js'
import { compilePage, createContext, type ShabdContext } from './context.js'

export interface Problem {
  level: 'error' | 'warning' | 'note'
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

/** Compile every page and collect problems with content, navigation and links. */
export async function collectProblems(context: ShabdContext): Promise<CheckResult> {
  const { config, store } = context
  const relative = (file: string) => path.relative(config.root, file)
  const problems: Problem[] = []
  const detailed: ShabdError[] = []

  const sidebarFile = relative(config.sidebarFile)
  for (const warning of store.sidebarWarnings()) {
    problems.push({ level: 'warning', file: sidebarFile, line: warning.line, message: warning.message })
  }

  // Compile everything first: links can only be checked against the full set of pages and anchors.
  const anchors = new Map<string, Set<string>>()
  const links: { file: string; target: string }[] = []
  for (const page of store.pages()) {
    try {
      const compiled = await compilePage(context, page)
      anchors.set(page.path, new Set(compiled.anchors))
      for (const target of compiled.links) links.push({ file: relative(page.file), target })
    } catch (error) {
      if (!isShabdError(error)) throw error
      detailed.push(error)
      // Its anchors are unknown, so links into this page are not second-guessed.
      anchors.set(page.path, new Set())
    }
  }

  const moved = new Map(config.redirects.map((redirect) => [redirect.from, redirect]))

  for (const { file, target } of links) {
    const [route = '', fragment] = target.split('#')
    const known = anchors.get(route)
    const redirect = moved.get(route)
    if (!known && redirect) {
      // The link works, by way of the redirect. It is still worth saying: the reader makes a stop they need not.
      problems.push({ level: 'warning', file, message: `Link to ${route}, which has moved to ${redirect.to}. Link there instead.` })
    } else if (!known) {
      problems.push({ level: 'error', file, message: `Broken link: no page at ${route}` })
    } else if (fragment && known.size > 0 && !known.has(decodeURIComponent(fragment))) {
      problems.push({ level: 'error', file, message: `Broken link: ${route} has no heading "#${fragment}"` })
    }
  }

  const configFile = relative(config.configFile)
  for (const redirect of config.redirects) {
    const line = config.locate(['redirects', redirect.key])?.line
    if (anchors.has(redirect.from)) {
      problems.push({
        level: 'error',
        file: configFile,
        line,
        message: `Redirect from ${redirect.from}: a page has that address, so the redirect is never used. Remove one of them.`,
      })
    }
    if (redirect.external) continue
    const route = redirectRoute(redirect.to)
    const fragment = redirect.to.split('#')[1]
    const known = anchors.get(route)
    if (!known) {
      problems.push({ level: 'error', file: configFile, line, message: `Redirect from ${redirect.from} leads to ${route}, where there is no page` })
    } else if (fragment && known.size > 0 && !known.has(decodeURIComponent(fragment))) {
      problems.push({
        level: 'error',
        file: configFile,
        line,
        message: `Redirect from ${redirect.from} leads to ${route}, which has no heading "#${fragment}"`,
      })
    }
  }

  for (const slug of store.sidebar.unlisted) {
    problems.push({
      level: 'note',
      file: sidebarFile,
      message: `/${slug} is published but not in the sidebar. Add it, or set \`sidebar: { exclude: true }\` in its frontmatter.`,
    })
  }

  return { problems, detailed }
}

const LABEL = { error: pc.red('error'), warning: pc.yellow('warning'), note: pc.dim('note') }

export function formatProblem(problem: Problem): string {
  const where = problem.line !== undefined ? `${problem.file}:${problem.line}` : problem.file
  return `  ${LABEL[problem.level]}  ${pc.cyan(where)}  ${problem.message}`
}

/** Returns true when the site has no errors. */
export async function check(root: string): Promise<boolean> {
  const context = await createContext(root, { dev: false })
  const { problems, detailed } = await collectProblems(context)
  await context.compiler.cache.flush()

  for (const error of detailed) console.error(`\n${error.pretty(context.config.root)}`)
  if (problems.length) console.log(`\n${problems.map(formatProblem).join('\n')}`)

  const errors = detailed.length + problems.filter((problem) => problem.level === 'error').length
  const warnings = problems.filter((problem) => problem.level === 'warning').length
  const count = context.store.pages().length
  const pages = `${count} ${count === 1 ? 'page' : 'pages'}`
  console.log(
    errors || warnings
      ? `\n${pc.bold(`${pages} checked:`)} ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}\n`
      : `\n${pc.green('✓')} ${pages} checked, no problems found\n`,
  )
  return errors === 0
}

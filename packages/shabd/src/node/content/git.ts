/**
 * When each page was last changed, read from the history Git keeps.
 *
 * One `git log` over the content folder answers for every page at once. The
 * date is the one the commit's author made the change on, in their own time
 * zone, so the day shown is the day they would say it was.
 *
 * Git may not be there, the folder may not be in a repository, and on a
 * build machine the repository is often cut down to its newest commit, where
 * every file would appear to have changed just now. In each case no dates
 * are given and a note says why: a date that is wrong is worse than none.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface GitDates {
  /** Absolute file path → the day of its last commit, as `2026-11-17`. */
  dates: Map<string, string>
  /** Why there are no dates, when there are none. */
  note?: string
}

/** A NUL before each date marks where a commit starts; a file name cannot contain one. */
const FORMAT = '--format=%x00%aI'

export async function lastCommitDates(dir: string): Promise<GitDates> {
  const dates = new Map<string, string>()
  const git = (args: string[]) =>
    // `core.quotepath=off` keeps file names with letters outside ASCII as they are, instead of in escapes.
    run('git', ['-c', 'core.quotepath=off', ...args], { cwd: dir, maxBuffer: 256 * 1024 * 1024 }).then((result) => result.stdout)

  try {
    if ((await git(['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') {
      return { dates, note: 'the content folder is not in a Git repository' }
    }
    if ((await git(['rev-parse', '--is-shallow-repository'])).trim() === 'true') {
      return {
        dates,
        note:
          'this is a shallow clone, which holds only the newest commits, so every page would show the same day. ' +
          'Fetch the whole history (on GitHub Actions: `fetch-depth: 0` on the checkout step)',
      }
    }
    // `--relative` gives paths from the content folder, wherever in the repository that is.
    const log = await git(['log', FORMAT, '--name-only', '--relative', '--', '.'])
    for (const commit of log.split('\0')) {
      const [date = '', ...files] = commit.split('\n')
      const day = date.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      for (const file of files) {
        if (!file) continue
        const absolute = path.join(dir, file)
        // The log runs from the newest commit back: the first date seen for a file is its last change.
        if (!dates.has(absolute)) dates.set(absolute, day)
      }
    }
    return dates.size ? { dates } : { dates, note: 'no commit has touched the content folder yet' }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return { dates, note: missing ? 'Git is not installed' : 'the content folder is not in a Git repository' }
  }
}

/** `2026-11-17` as a reader of this language would write it: "17 November 2026". */
export function formatDay(day: string, lang: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(date)
  } catch {
    // `site.lang` is free text, and may be a language tag Intl does not know.
    return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
  }
}

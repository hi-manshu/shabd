/**
 * A second look at a file, a moment after it changed.
 *
 * Vite's watcher reports a file as changed at most once in 50 milliseconds,
 * and drops a change that follows another inside that time. An editor that
 * saves in two writes, or a formatter that runs on save, then leaves the dev
 * server holding the first of the two, with nothing to tell it there was a
 * second. Node's own watcher, which Shabd also listens to, has no such limit
 * on macOS. On Linux the second change was seen to be lost.
 *
 * So each change that is handled is followed by reading the file once more.
 * If it no longer holds what was read when the change was handled, that is
 * reported as a change like any other, and handled the same way: which
 * arranges a look after that one too, and that look finds nothing new.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** Longer than the 50 milliseconds in which a second change goes unreported, and short enough to pass unnoticed. */
export const SECOND_LOOK_MS = 120

const digest = (text: string) => createHash('sha1').update(text).digest('hex')

export interface SecondLookOptions {
  /** Tell the dev server that a file changed. */
  report(file: string): void
  /** Read a file. The file system, unless a test says otherwise. */
  read?: (file: string) => Promise<string>
  delay?: number
}

export class SecondLook {
  #timers = new Map<string, ReturnType<typeof setTimeout>>()
  #report: (file: string) => void
  #read: (file: string) => Promise<string>
  #delay: number

  constructor(options: SecondLookOptions) {
    this.#report = options.report
    this.#read = options.read ?? ((file) => readFile(file, 'utf8'))
    this.#delay = options.delay ?? SECOND_LOOK_MS
  }

  /**
   * A change to `file` was handled, and `text` is what the file held then.
   * Changes that follow each other closely share one look, after the last.
   */
  after(file: string, text: string): void {
    const held = digest(text)
    clearTimeout(this.#timers.get(file))
    const timer = setTimeout(() => {
      this.#timers.delete(file)
      this.#read(file).then(
        (now) => {
          if (digest(now) !== held) this.#report(file)
        },
        // Gone since, or unreadable: the watcher reports a removal on its own, and there is nothing to compare.
        () => {},
      )
    }, this.#delay)
    // A look that is still due does not keep a process alive that is otherwise done.
    timer.unref()
    this.#timers.set(file, timer)
  }

  /** Forget the looks that are still due. */
  close(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer)
    this.#timers.clear()
  }
}

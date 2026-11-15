import { spawn } from 'node:child_process'

/**
 * Keep the display awake while the tests run (macOS only).
 *
 * On the machine these tests were written on, WebKit stopped answering
 * clicks for whole runs: Playwright reported that `<html>` intercepted the
 * pointer, while the page itself hit-tested correctly when checked by hand.
 * It happened in runs long enough for the display to go to sleep (it was set
 * to two minutes) and not in runs started right after someone had used the
 * machine. That points at the display, though it was not proven. `caffeinate`
 * ships with macOS; it wakes the display and holds it until this process exits.
 */
export default function globalSetup(): void {
  if (process.platform !== 'darwin') return
  const run = (args: string[]) => spawn('caffeinate', args, { stdio: 'ignore', detached: true }).unref()
  run(['-u', '-t', '2'])
  run(['-d', '-w', String(process.pid)])
}

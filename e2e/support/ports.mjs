/**
 * The ports the two test servers listen on.
 *
 * `SHABD_E2E_PORT` moves both, so that two checkouts of this repository can
 * run the browser tests at the same time:
 *
 *     SHABD_E2E_PORT=4511 npx playwright test
 */
const first = Number(process.env.SHABD_E2E_PORT ?? 4411)
if (!Number.isInteger(first) || first < 1 || first > 65534) {
  throw new Error(`SHABD_E2E_PORT must be a port number, got "${process.env.SHABD_E2E_PORT}"`)
}

/** `shabd dev` listens on the first, `shabd preview` on the next one up. */
export const PORTS = { dev: first, preview: first + 1 }

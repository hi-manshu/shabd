/**
 * Host adapters: `shabd build --adapter cloudflare | vercel | netlify`.
 *
 * `shabd build` writes files, and a host that serves files answers `GET`.
 * The MCP endpoint answers `POST`, so on a deployed site it exists only if
 * something runs code. An adapter writes that something in the form one
 * host takes it, and the site's redirects in that host's own format.
 *
 * One module per host says what is written and which page of the host's
 * documentation each detail comes from. `shared.ts` holds what they have in
 * common, and `function/` the code that runs on the host.
 */
import { isAdapterName, unknownAdapter, type AdapterName } from '../../shared/adapters.js'
import type { ResolvedConfig } from '../config/load.js'
import { cloudflare } from './cloudflare.js'
import { netlify } from './netlify.js'
import type { Adapter } from './shared.js'
import { vercel } from './vercel.js'

export type { Adapter, AdapterInput, AdapterOutput, MovedAddress } from './shared.js'

export const adapters: Record<AdapterName, Adapter> = { cloudflare, vercel, netlify }

/**
 * The adapter a build runs: the one asked for on the command line, or else
 * the one the config names. A name that is not an adapter is an error that
 * lists the ones there are.
 */
export function chooseAdapter(asked: string | undefined, config: ResolvedConfig): Adapter | undefined {
  const name = asked ?? config.config.build.adapter
  if (name === undefined) return undefined
  if (!isAdapterName(name)) throw new Error(unknownAdapter(name))
  return adapters[name]
}

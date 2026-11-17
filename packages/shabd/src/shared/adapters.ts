/**
 * The hosts `shabd build --adapter <name>` can write for.
 *
 * The names are here, apart from the schema, so that the command line can
 * check one without loading Zod. What each adapter writes is in
 * src/node/adapters.
 */
export const ADAPTERS = ['cloudflare', 'vercel', 'netlify'] as const
export type AdapterName = (typeof ADAPTERS)[number]

export function isAdapterName(name: string): name is AdapterName {
  return (ADAPTERS as readonly string[]).includes(name)
}

/** What to say when a name is not one of them. */
export function unknownAdapter(name: string): string {
  return `Unknown adapter "${name}". The adapters are: ${ADAPTERS.join(', ')}`
}

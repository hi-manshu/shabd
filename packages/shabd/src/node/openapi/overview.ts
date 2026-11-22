/**
 * The overview page: what the API is, where it is served, how a caller is
 * let in, and every operation with a link to its page.
 */
import { entriesOf, isNode, textOf, type Node } from './document.js'
import { code, ended, escapeText, firstSentence, frontmatter, inline, keep, oneLine, table } from './markdown.js'
import { readMore, type Operation, type Reader } from './operation.js'
import { authOf, schemeOf, serversOf, type Server } from './request.js'

export interface Group {
  label: string
  /** The tag the group is made from, as the document declares it. Empty for a tag it does not declare, and absent for the operations that have none. */
  tag?: Node
  operations: (Operation & { slug: string })[]
}

const WHERE = 'the overview'

/** The ways OAuth 2.0 gives out a token, by the names the standard has for them. */
const FLOWS = new Map([
  ['authorizationCode', 'Authorization code'],
  ['clientCredentials', 'Client credentials'],
  ['implicit', 'Implicit'],
  ['password', 'Password'],
])

export function overviewPage(reader: Reader, title: string, groups: Group[]): string {
  const { description } = reader
  const info = isNode(description.root.info) ? description.root.info : {}
  const about = textOf(info.description)
  const summary = oneLine(textOf(info.summary) ?? '') || (about === undefined ? '' : firstSentence(about))
  const version = textOf(info.version)

  const blocks = [
    // Before the description, which may end in a section of its own that the version is no part of.
    version === undefined ? '' : `Version ${code(version)}.`,
    about === undefined ? '' : keep(about, { headings: 3, dropped: description.pictures(WHERE) }),
    readMore(description.root),
    ...serverBlocks(reader),
    ...authBlocks(reader),
    ...operationBlocks(reader, groups),
  ]
  // The page has no file of its own in the repository to edit.
  const page = frontmatter({ title, ...(summary ? { description: summary } : {}), editLink: false })
  return `${page}\n${blocks.filter(Boolean).join('\n\n')}\n`
}

function serverBlocks({ description }: Reader): string[] {
  // An address of `/` says the API is served from wherever the description is, which is nothing to show.
  const servers = serversOf(description.root).filter((server) => server.url !== '')
  const about = (server: Server) => {
    const said = server.description === undefined ? '' : inline(server.description, description.pictures(WHERE))
    if (server.template === undefined) return said
    const variables = server.variables.map(
      ({ name, value, others }) => `${code(name)} is ${code(value)} here${others.length > 0 ? ` and can be ${others.map(code).join(', ')}` : ''}`,
    )
    return [ended(said), `Written ${code(server.template)} in the description: ${variables.join('; ')}.`].filter(Boolean).join(' ')
  }

  if (servers.length === 0) return []
  if (servers.length === 1) return ['## Base URL', code(servers[0]!.url), about(servers[0]!)]
  return ['## Base URLs', table(['Address', 'What it is'], servers.map((server) => [code(server.url), about(server)]))]
}

function authBlocks({ description }: Reader): string[] {
  const { root } = description
  const items = entriesOf(isNode(root.components) ? root.components.securitySchemes : undefined).flatMap(([name, written]) => {
    const where = `the security scheme \`${name}\``
    const scheme = description.resolve(written, where)?.node
    if (!scheme) return []
    const { phrase, header, user } = schemeOf(name, scheme)
    const about = textOf(scheme.description)
    const settings = textOf(scheme.openIdConnectUrl)
    const said = [
      `${escapeText(phrase)}.`,
      header?.[0] === 'Authorization' ? `Send ${code(`${header[0]}: ${header[1]}`)}.` : '',
      user ? 'Send `Authorization: Basic` and then the user name and the password, joined by a colon and written in Base64.' : '',
      settings ? `Its settings are at ${code(settings)}.` : '',
      about === undefined ? '' : inline(about, description.pictures(where)),
    ]
    const lines = [`- ${code(name)}: ${said.filter(Boolean).join(' ')}`]

    const scopes = new Map<string, string>()
    for (const [kind, flow] of entriesOf(scheme.flows)) {
      if (!isNode(flow)) continue
      const steps = [
        textOf(flow.authorizationUrl) ? `authorise at ${code(textOf(flow.authorizationUrl)!)}` : '',
        textOf(flow.tokenUrl) ? `get a token from ${code(textOf(flow.tokenUrl)!)}` : '',
        textOf(flow.refreshUrl) ? `refresh it at ${code(textOf(flow.refreshUrl)!)}` : '',
      ].filter(Boolean)
      lines.push(`  - ${escapeText(FLOWS.get(kind) ?? oneLine(kind))} flow${steps.length > 0 ? `: ${steps.join(', ')}` : ''}.`)
      for (const [scope, meaning] of entriesOf(flow.scopes)) if (!scopes.has(scope)) scopes.set(scope, oneLine(textOf(meaning) ?? ''))
    }
    if (scopes.size > 0) {
      lines.push(`  - Scopes: ${[...scopes].map(([scope, meaning]) => `${code(scope)}${meaning ? ` (${escapeText(meaning)})` : ''}`).join(', ')}.`)
    }
    return [lines.join('\n')]
  })

  if (items.length === 0) return []
  const usual = authOf(description).phrase
  return ['## Authentication', usual === 'none' ? '' : `Unless its page says otherwise, an operation needs: ${escapeText(usual)}.`, items.join('\n')]
}

function operationBlocks({ description }: Reader, groups: Group[]): string[] {
  if (groups.length === 0) return []
  const blocks = ['## Operations']
  for (const { label, tag, operations } of groups) {
    // Operations with no tag, and no other group beside them, need no heading of their own.
    if (tag !== undefined || groups.length > 1) blocks.push(`### ${escapeText(oneLine(label))}`)
    const about = textOf(tag?.description)
    if (about !== undefined) blocks.push(keep(about, { headings: 4, dropped: description.pictures(WHERE) }))
    if (tag !== undefined) blocks.push(readMore(tag))
    blocks.push(
      operations
        // A link to a page is written as the path of its file, as on GitHub.
        .map(({ title, slug, method, path, deprecated }) => `- [${escapeText(title)}](./${slug}.md): ${code(`${method} ${oneLine(path)}`)}${deprecated ? ' (deprecated)' : ''}`)
        .join('\n'),
    )
  }
  return blocks
}

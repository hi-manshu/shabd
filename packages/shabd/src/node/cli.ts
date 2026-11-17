/**
 * The `shabd` command.
 *
 *   shabd dev [root]       start the dev server
 *   shabd build [root]     write the static site to dist/
 *   shabd preview [root]   serve dist/ (with the MCP route)
 *   shabd check [root]     validate config, sidebar, frontmatter and links
 *   shabd mcp [root]       run the docs MCP server over stdio
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import pc from 'picocolors'
import { isShabdError } from './config/errors.js'
import { packageVersion } from './paths.js'

const HELP = `
${pc.bold('shabd')} ${pc.dim(`v${packageVersion()}`)}

${pc.bold('Usage')}
  shabd <command> [root] [options]

${pc.bold('Commands')}
  dev       Start the dev server                       ${pc.dim('(default)')}
  build     Build the static site into dist/
  preview   Serve the built site, including the MCP route
  check     Validate config, sidebar, frontmatter and internal links
  mcp       Run the docs MCP server over stdio, for local AI agents

${pc.bold('Options')}
  --port <number>   Port for dev and preview
  --host [address]  Expose the server on the network
  --open            Open the browser when the server starts
  --no-semantic     Build without embeddings (keyword search only)
  --adapter <host>  With build: also write the MCP endpoint as a function for
                    cloudflare, vercel or netlify
  -h, --help        Show this help
  -v, --version     Show the version
`

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      open: { type: 'boolean' },
      'no-semantic': { type: 'boolean' },
      adapter: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

  if (values.version) {
    console.log(packageVersion())
    return
  }
  const [command = 'dev', rootArgument = '.'] = positionals
  if (values.help || command === 'help') {
    console.log(HELP)
    return
  }

  const root = path.resolve(rootArgument)
  const port = values.port !== undefined ? Number(values.port) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    fail(`--port must be a number between 0 and 65535, got "${values.port}"`)
  }
  const host = values.host === undefined ? undefined : values.host === '' ? true : values.host

  try {
    switch (command) {
      case 'dev': {
        const { dev } = await import('./dev.js')
        const server = await dev(root, { port, host, open: values.open })
        server.printUrls()
        server.bindCLIShortcuts({ print: true })
        break
      }
      case 'build': {
        const { build } = await import('./build/build.js')
        const { ADAPTERS, isAdapter } = await import('./build/adapters.js')
        const adapter = values.adapter
        if (adapter !== undefined && !isAdapter(adapter)) {
          fail(`--adapter takes one of ${ADAPTERS.join(', ')}. Got "${adapter}".`)
        }
        await build(root, { semantic: !values['no-semantic'], ...(adapter ? { adapter } : {}) })
        break
      }
      case 'preview': {
        const { preview } = await import('./build/preview.js')
        await preview(root, { port, host })
        break
      }
      case 'check': {
        const { check } = await import('./check.js')
        const ok = await check(root)
        if (!ok) process.exitCode = 1
        break
      }
      case 'mcp': {
        const { serveStdio } = await import('./mcp/stdio.js')
        await serveStdio(root)
        break
      }
      default:
        fail(`Unknown command "${command}". Run "shabd --help" to see what is available.`)
    }
  } catch (error) {
    if (isShabdError(error)) {
      console.error(`\n${error.pretty()}\n`)
      process.exit(1)
    }
    throw error
  }
}

function fail(message: string): never {
  console.error(pc.red(message))
  process.exit(1)
}

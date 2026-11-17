/**
 * The `shabd` command.
 *
 *   shabd dev [root]       start the dev server
 *   shabd build [root]     write the static site to dist/
 *   shabd preview [root]   serve dist/ (with the MCP route)
 *   shabd check [root]     validate config, sidebar, frontmatter and links
 *   shabd mcp [root]       run the docs MCP server over stdio
 *   shabd import <site>    make a Shabd site from one made with another tool
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
  import    Make a Shabd site from a Docusaurus, VitePress, Starlight or MkDocs site
            ${pc.dim('shabd import <site> [--out <folder>] [--from <tool>] [--force]')}

${pc.bold('Options')}
  --port <number>   Port for dev and preview
  --host [address]  Expose the server on the network
  --open            Open the browser when the server starts
  --no-semantic     Build without embeddings (keyword search only)
  --external        check: also ask links to other sites whether they answer
  --format <name>   check: text ${pc.dim('(default)')}, json, or github for annotations in a pull request
  --out <folder>    Where import writes the new site ${pc.dim('(default: <site>-shabd)')}
  --from <tool>     The tool that made the site to import: docusaurus, vitepress,
                    starlight or mkdocs ${pc.dim('(default: its config file decides)')}
  --force           Let import write into a folder that is not empty
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
      external: { type: 'boolean' },
      format: { type: 'string' },
      out: { type: 'string' },
      from: { type: 'string' },
      force: { type: 'boolean' },
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
        await build(root, { semantic: !values['no-semantic'] })
        break
      }
      case 'preview': {
        const { preview } = await import('./build/preview.js')
        const server = await preview(root, { port, host })
        server.printUrls()
        break
      }
      case 'check': {
        const { check, CHECK_FORMATS } = await import('./check.js')
        const format = values.format ?? 'text'
        if (!(CHECK_FORMATS as readonly string[]).includes(format)) {
          fail(`--format must be one of ${CHECK_FORMATS.join(', ')}, got "${format}"`)
        }
        const ok = await check(root, { external: values.external === true, format: format as (typeof CHECK_FORMATS)[number] })
        if (!ok) process.exitCode = 1
        break
      }
      case 'mcp': {
        const { serveStdio } = await import('./mcp/stdio.js')
        await serveStdio(root)
        break
      }
      case 'import': {
        if (positionals[1] === undefined) {
          fail('shabd import needs the folder of the site to import: shabd import <site> [--out <folder>]')
        }
        const { formatReport, hasErrors, importSite } = await import('./import/index.js')
        const result = await importSite(positionals[1], { out: values.out, from: values.from, force: values.force })
        console.log(formatReport(result))
        // The site is written either way. The exit code says whether Shabd would build it as it is.
        if (hasErrors(result)) process.exitCode = 1
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
    if (error instanceof Error && error.name === 'ImportError') fail(error.message)
    throw error
  }
}

function fail(message: string): never {
  console.error(pc.red(message))
  process.exit(1)
}

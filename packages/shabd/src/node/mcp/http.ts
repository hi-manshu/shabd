/**
 * The `/mcp` route as a web-standard handler: `(Request) => Promise<Response>`.
 *
 * That signature is what Node (via src/node/http.ts), Cloudflare Workers,
 * Deno, Bun and Vercel/Netlify functions all accept, so the same handler
 * serves the dev server, `shabd preview` and a production deployment.
 *
 * The endpoint is stateless. Each POST gets a fresh server and transport and
 * a plain JSON reply, so it needs no session storage and scales to zero.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createDocsServer } from './server.js'
import type { DocsSource } from './source.js'

export interface McpHandlerOptions {
  /**
   * Which browser origins may call the endpoint.
   *   'any'    everyone (the default: the docs are public and the tools only read them)
   *   'local'  only pages served from this machine (used by the dev server, which
   *            must not be reachable from other websites the developer has open)
   */
  origins?: 'any' | 'local'
}

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])$/

function originAllowed(request: Request, policy: 'any' | 'local'): boolean {
  if (policy === 'any') return true
  const origin = request.headers.get('origin')
  // Requests without an Origin header do not come from a web page.
  if (!origin) return true
  try {
    return LOCAL_HOST.test(new URL(origin).hostname)
  } catch {
    return false
  }
}

function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function createMcpHandler(
  source: DocsSource | (() => DocsSource | Promise<DocsSource>),
  options: McpHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const policy = options.origins ?? 'any'

  const cors = (request: Request): Record<string, string> => {
    const origin = request.headers.get('origin')
    if (!origin || !originAllowed(request, policy)) return {}
    return {
      'Access-Control-Allow-Origin': policy === 'any' ? '*' : origin,
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Expose-Headers': 'Mcp-Protocol-Version',
      Vary: 'Origin',
    }
  }

  return async (request) => {
    if (!originAllowed(request, policy)) return rpcError(403, 'This origin may not call the MCP endpoint.')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) })
    if (request.method !== 'POST') {
      // No server-initiated stream and no sessions to delete: POST is the whole protocol here.
      return rpcError(405, 'This MCP endpoint is stateless. Send JSON-RPC requests with POST.', {
        Allow: 'POST, OPTIONS',
        ...cors(request),
      })
    }

    const docs = typeof source === 'function' ? await source() : source
    const server = createDocsServer(docs)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    try {
      await server.connect(transport)
      const response = await transport.handleRequest(request)
      const headers = new Headers(response.headers)
      for (const [name, value] of Object.entries(cors(request))) headers.set(name, value)
      return new Response(response.body, { status: response.status, headers })
    } catch (error) {
      return rpcError(500, error instanceof Error ? error.message : 'Internal error', cors(request))
    } finally {
      void server.close().catch(() => {})
    }
  }
}

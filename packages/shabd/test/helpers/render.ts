/** Evaluate a compiled page module and render it to static HTML. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MDX_COMPONENTS_ID } from '../../src/node/markdown/compile.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp')
let counter = 0

const COMPONENTS = `
import { createElement as h } from 'react'
export function useMDXComponents() {
  return {
    Callout: ({ type, title, children }) => h('aside', { 'data-callout': type, 'data-title': title }, children),
    Sandbox: ({ code, lang, group }) => h('div', { 'data-sandbox': lang, 'data-group': group }, code),
    Mermaid: ({ code }) => h('div', { 'data-mermaid': '' }, code),
  }
}
`

export async function renderCompiled(code: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'components.mjs'), COMPONENTS)
  const file = path.join(dir, `page-${process.pid}-${counter++}.mjs`)
  await writeFile(file, code.replaceAll(MDX_COMPONENTS_ID, './components.mjs'))
  const module = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default: () => React.ReactNode }
  return renderToStaticMarkup(createElement(module.default))
}

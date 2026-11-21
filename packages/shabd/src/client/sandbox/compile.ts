/**
 * Turns the text of a live snippet into a React component, in the page.
 *
 * The text is made into a script by src/shared/snippet.ts, which `shabd check`
 * uses too, and the script is run by run.ts.
 */
import type { ComponentType } from 'react'
import { transformSnippet } from '../../shared/snippet.js'
import { runSnippet, type Loaders, type Modules, type Scope } from './run.js'

export type { Loaders, Modules, Scope }

export async function compileSnippet(source: string, scope: Scope, modules: Modules, loaders: Loaders = {}): Promise<ComponentType> {
  return runSnippet(await transformSnippet(source), scope, modules, loaders)
}

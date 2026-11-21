/** The grammar for a live snippet: TypeScript with JSX. */
import { javascript } from '@codemirror/lang-javascript'
import type { Extension } from '@codemirror/state'

export const grammar: Extension = javascript({ jsx: true, typescript: true })

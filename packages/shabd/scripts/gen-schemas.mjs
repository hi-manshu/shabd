/**
 * Writes JSON Schemas for shabd.config.yaml and sidebar.yaml from the Zod
 * schemas, so editors can validate and autocomplete the YAML:
 *
 *     # yaml-language-server: $schema=./node_modules/@himanshoe/shabd/schemas/config.schema.json
 *
 * Runs after `tsc` as part of `npm run build`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { ConfigSchema, SidebarsSchema } from '../dist/shared/schema.js'

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas')
await mkdir(outDir, { recursive: true })

const schemas = {
  'config.schema.json': { schema: ConfigSchema, title: 'Shabd site configuration (shabd.config.yaml)' },
  // One sidebar as a list, or several as a map: the file may be either.
  'sidebar.schema.json': { schema: SidebarsSchema, title: 'Shabd sidebar (sidebar.yaml)' },
}

for (const [file, { schema, title }] of Object.entries(schemas)) {
  // `io: 'input'` describes what authors write (shorthands included), not the normalised result.
  const json = { title, ...z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-7' }) }
  await writeFile(path.join(outDir, file), `${JSON.stringify(json, null, 2)}\n`)
}

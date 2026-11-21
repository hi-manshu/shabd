/**
 * An OpenAPI description from a file.
 *
 * A mistake in the file is a ShabdError with the line it is on, like a
 * mistake in any other YAML that Shabd reads. So is a file that turns out
 * not to be OpenAPI 3.0 or 3.1: this is the one place that knows both the
 * file and what is in it, and so the one place that can point at the line
 * that says `swagger: "2.0"`.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { LineCounter, parseDocument } from 'yaml'
import { ShabdError } from '../config/errors.js'
import { parseYaml, type ParsedYaml } from '../config/yaml.js'
import { refusal } from './document.js'

/**
 * Read and parse a description from a `.yaml`, `.yml` or `.json` file. A
 * file whose name ends in `.json` is read as JSON, and any other as YAML.
 */
export async function readOpenApi(file: string): Promise<unknown> {
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    throw new ShabdError(file, [{ path: [], message: `There is no file at ${file}` }])
  }

  const read = path.extname(file).toLowerCase() === '.json' ? readJson(file, source) : parseYaml(file, source)
  const issue = refusal(read.data)
  if (issue) {
    const locate = read.locate ?? linesOf(file, source)
    throw new ShabdError(file, [{ ...issue, ...locate?.(issue.path, 'key') }], source)
  }
  return read.data
}

/**
 * JSON, read by `JSON.parse`: it is many times faster than the YAML parser,
 * and a description can be several megabytes.
 *
 * When `JSON.parse` refuses the file it says what is wrong, and not always
 * where. So the file is read again as YAML, which JSON is a kind of, held to
 * the values JSON has. Either that finds the mistake, and knows its line, or
 * it reads the file: a comma after the last item of a list is a mistake in
 * JSON and none in YAML, and such a file is read all the same.
 */
function readJson(file: string, source: string): { data: unknown; locate?: ParsedYaml['locate'] } {
  try {
    // A byte order mark is not JSON, and editors on Windows write one.
    return { data: JSON.parse(source.replace(/^\uFEFF/, '')) }
  } catch {
    const lineCounter = new LineCounter()
    const strict = parseDocument(source, { lineCounter, schema: 'json', prettyErrors: false })
    if (strict.errors.length > 0) {
      throw new ShabdError(
        file,
        strict.errors.map((error) => {
          const position = lineCounter.linePos(error.pos[0])
          return { message: error.message, path: [], line: position.line, column: position.col }
        }),
        source,
      )
    }
    return parseYaml(file, source)
  }
}

/** Where each key of a JSON file is written. `JSON.parse` keeps no lines, so the file is read once more for them. */
function linesOf(file: string, source: string): ParsedYaml['locate'] | undefined {
  try {
    return parseYaml(file, source).locate
  } catch {
    // JSON that YAML will not read, such as a key written twice: the error goes without a line.
    return undefined
  }
}

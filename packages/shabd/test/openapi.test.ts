/** Pages made from an OpenAPI description: what they hold, and that Shabd takes them as pages. */
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { collectProblems } from '../src/node/check.js'
import { isShabdError, type ShabdError } from '../src/node/config/errors.js'
import { parseFrontmatter } from '../src/node/content/frontmatter.js'
import { compilePage, createContext, isSplit } from '../src/node/context.js'
import { pageMarkdown } from '../src/node/llms/markdown.js'
import { generateApiPages, readOpenApi, type GeneratedApi } from '../src/node/openapi/index.js'
import { renderCompiled } from './helpers/render.js'
import { failure, temporarySites } from './helpers/site.js'

const site = temporarySites()

/** A small pet store: what a description of a real API looks like, with one of each thing the generator has to read. */
const PETSTORE = `
openapi: 3.1.0
info:
  title: Petstore
  version: 1.2.0
  description: |
    Keeps track of the pets in a store, and of who they belong to.

    # Errors

    Every error has a \`code\` and a \`message\`.
servers:
  - url: https://api.petstore.example/v1/
    description: Production
security:
  - bearerAuth: []
tags:
  - name: Pets
    description: The animals themselves.
  - name: Store
    description: What the store sorts its pets into.
paths:
  /pets:
    get:
      operationId: listPets
      tags: [Pets]
      summary: List pets
      description: |
        Returns the pets the caller may see, oldest first. A page holds at most \`limit\` pets.

        ## Paging

        Pass the \`X-Next\` of one page as \`after\` to get the page that follows.
      parameters:
        - name: limit
          in: query
          description: How many pets to return
          schema: { type: integer, format: int32, minimum: 1, maximum: 100, default: 20 }
        - name: status
          in: query
          required: true
          description: Only pets with this status.
          schema: { type: string, enum: [available, pending, sold] }
          example: available
        - name: tags
          in: query
          description: Only pets with all of these tags.
          explode: false
          schema: { type: array, items: { type: string } }
        - $ref: '#/components/parameters/RequestId'
      responses:
        '200':
          description: A page of pets.
          headers:
            X-Next:
              description: Where the page after this one starts.
              schema: { type: string }
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Pet' }
        default:
          $ref: '#/components/responses/Error'
    post:
      operationId: addPet
      tags: [Pets]
      summary: Add a pet
      requestBody:
        required: true
        description: The pet to add.
        content:
          application/json:
            schema: { $ref: '#/components/schemas/NewPet' }
            example: { name: Rex, kind: { species: dog, goodBoy: true }, tags: [friendly] }
      responses:
        '201':
          description: The pet as the store keeps it.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
          links:
            GetPetById: { operationId: getPet }
        '422': { $ref: '#/components/responses/Error' }
      callbacks:
        onAdopted:
          '{$request.body#/callbackUrl}':
            post:
              responses: { '200': { description: Heard. } }
  /pets/{petId}:
    parameters:
      - name: petId
        in: path
        required: true
        description: The id of the pet.
        schema: { type: integer, format: int64 }
    get:
      operationId: getPet
      tags: [Pets]
      summary: Get a pet
      security: []
      responses:
        '200':
          description: The pet.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
        '404': { $ref: '#/components/responses/Error' }
    put:
      operationId: replacePet
      tags: [Pets]
      summary: Replace a pet
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
      responses:
        '200':
          description: The pet as the store keeps it now.
    delete:
      tags: [Pets]
      summary: Remove a pet
      deprecated: true
      description: Takes the pet out of the store for good. Archive it instead.
      responses:
        '204': { description: The pet is gone. }
  /store/categories:
    get:
      operationId: listCategories
      tags: [Store]
      summary: List categories
      responses:
        '200':
          description: Every category, with the ones inside it.
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Category' }
  /health:
    get:
      security: []
      responses:
        '200':
          description: The service is up.
          content:
            text/plain:
              schema: { type: string }
              example: ok
webhooks:
  petAdopted:
    post:
      responses: { '200': { description: Heard. } }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: A token from the dashboard.
  parameters:
    RequestId:
      name: X-Request-Id
      in: header
      description: Sent back with the response, to tell requests apart.
      schema: { type: string, format: uuid }
  responses:
    Error:
      description: What went wrong.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
  schemas:
    NewPet:
      type: object
      required: [name, kind]
      properties:
        name: { type: string, minLength: 1, description: What the pet answers to., example: Rex }
        kind:
          description: What sort of animal it is.
          oneOf:
            - $ref: '#/components/schemas/Dog'
            - $ref: '#/components/schemas/Cat'
          discriminator: { propertyName: species }
        tags: { type: array, items: { type: string }, description: Words to find the pet by. }
        bornOn: { type: [string, 'null'], format: date, description: 'The day it was born, when that is known.' }
        owner: { $ref: '#/components/schemas/Owner' }
    Pet:
      allOf:
        - $ref: '#/components/schemas/NewPet'
        - type: object
          required: [id, status]
          properties:
            id: { type: integer, format: int64, readOnly: true, description: Given by the store. }
            status: { type: string, enum: [available, pending, sold], default: available }
    Dog:
      type: object
      required: [species]
      properties:
        species: { const: dog }
        goodBoy: { type: boolean }
    Cat:
      type: object
      required: [species]
      properties:
        species: { const: cat }
        lives: { type: integer, maximum: 9 }
    Owner:
      type: object
      properties:
        name: { type: string }
        address:
          type: object
          properties:
            city: { type: string }
            country: { type: string, minLength: 2, maxLength: 2, description: As two letters. }
    Category:
      type: object
      required: [name]
      properties:
        name: { type: string }
        parent:
          description: The category this one is in.
          anyOf:
            - $ref: '#/components/schemas/Category'
            - type: 'null'
        children:
          type: array
          items: { $ref: '#/components/schemas/Category' }
    Error:
      type: object
      xml: { name: error }
      required: [code, message]
      properties:
        code: { type: string }
        message: { type: string }
        help: { $ref: './errors.yaml#/components/schemas/Help' }
`

const petstore = (options?: Parameters<typeof generateApiPages>[1]) => generateApiPages(parse(PETSTORE), options)
const source = (api: GeneratedApi, slug: string) => api.pages.find((page) => page.slug === slug)!.source
/** A page's frontmatter, as Shabd reads it. */
const frontmatter = (text: string) => parseFrontmatter('/site/content/api/page.md', text, ['doc', 'splash', 'api']).frontmatter
/** What a page says under one of its `##` headings. */
const section = (text: string, heading: string) => {
  const start = text.indexOf(`\n## ${heading}\n`)
  const end = text.indexOf('\n## ', start + 1)
  return start === -1 ? '' : text.slice(start + 1, end === -1 ? undefined : end)
}
const HEAD = '| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n'
const FIELDS = '| Field | Type | Required | Description |\n| --- | --- | --- | --- |\n'

/** A document with one operation, for looking at one thing. */
const one = (operation: Record<string, unknown>, rest: Record<string, unknown> = {}) => {
  const api = generateApiPages({ openapi: '3.0.3', info: { title: 'One' }, paths: { '/thing': { get: { operationId: 'thing', ...operation } } }, ...rest })
  return { api, page: source(api, 'thing') }
}
/** The same, where the thing to look at is the schema of the response. */
const response = (schema: unknown, rest: Record<string, unknown> = {}) =>
  one({ responses: { 200: { description: 'Fine.', content: { 'application/json': { schema } } } } }, rest)

async function rejection(run: () => Promise<unknown>): Promise<ShabdError> {
  try {
    await run()
  } catch (error) {
    if (isShabdError(error)) return error
    throw error
  }
  throw new Error('expected a ShabdError')
}

/** Put the pages in a site, and give back each one as Shabd makes it: compiled as the `.md` it is, and again as MDX. */
async function inSite(api: GeneratedApi, config = 'site:\n  title: Docs\n') {
  const files = Object.fromEntries(api.pages.map((page) => [`content/api/${page.slug}.md`, page.source]))
  const context = await createContext(await site({ 'shabd.config.yaml': config, ...files }), { dev: false })
  const pages = []
  for (const page of context.store.pages()) {
    const compiled = await compilePage(context, page)
    const asMdx = await context.compiler.compile({
      file: page.file.replace(/\.md$/, '.mdx'),
      id: page.id.replace(/\.md$/, '.mdx'),
      routePath: page.path,
      source: page.source,
      format: 'mdx',
      // Laid out as the page itself is: the api layout sets code beside prose.
      split: isSplit(context, page),
    })
    pages.push({ page, compiled, html: await renderCompiled(compiled.code), mdx: await renderCompiled(asMdx.code) })
  }
  return { context, pages }
}

describe('pages made from an OpenAPI description', () => {
  it('are an overview, then a page for each operation, in groups by first tag with the untagged last', () => {
    const api = petstore()
    expect(api.title).toBe('Petstore')
    expect(api.pages.map((page) => page.slug)).toEqual([
      'index',
      'pets/list-pets',
      'pets/add-pet',
      'pets/get-pet',
      'pets/replace-pet',
      'pets/delete-pets-pet-id',
      'store/list-categories',
      'get-health',
    ])
    expect(api.groups).toEqual([
      { label: 'Pets', slugs: ['pets/list-pets', 'pets/add-pet', 'pets/get-pet', 'pets/replace-pet', 'pets/delete-pets-pet-id'] },
      { label: 'Store', slugs: ['store/list-categories'] },
      { label: 'Other', slugs: ['get-health'] },
    ])
  })

  it('carry the request line in the frontmatter the api layout reads', () => {
    const api = petstore()
    expect(frontmatter(source(api, 'pets/list-pets'))).toMatchObject({
      title: 'List pets',
      description: 'Returns the pets the caller may see, oldest first.',
      layout: 'api',
      editLink: false,
      badges: [],
      api: { method: 'GET', path: '/pets', baseUrl: 'https://api.petstore.example/v1', auth: 'Bearer token (JWT)', deprecated: false, try: false },
    })
    // An operation that says `security: []` needs nothing, whatever the document asks of the rest.
    expect(frontmatter(source(api, 'pets/get-pet')).api).toMatchObject({ method: 'GET', path: '/pets/{petId}', auth: 'none' })
    // With no summary, the method and the path are the title, and with no description there is none.
    expect(frontmatter(source(api, 'get-health')).title).toBe('GET /health')
    expect(frontmatter(source(api, 'get-health')).description).toBeUndefined()

    const removed = frontmatter(source(api, 'pets/delete-pets-pet-id'))
    expect(removed.api?.deprecated).toBe(true)
    expect(removed.badges).toEqual([{ text: 'Deprecated', variant: 'danger' }])
  })

  it('ask for a "Try it" panel on every operation when told to, and not on the overview', () => {
    const api = petstore({ tryIt: true })
    for (const page of api.pages.slice(1)) expect(frontmatter(page.source).api?.try, page.slug).toBe(true)
    expect(frontmatter(source(api, 'index')).api).toBeUndefined()
    expect(source(petstore(), 'pets/list-pets')).not.toContain('try:')
  })

  it('keep a description as it is written, with its headings moved below the headings of the page', () => {
    const page = source(petstore(), 'pets/list-pets')
    expect(page).toContain(
      'Returns the pets the caller may see, oldest first. A page holds at most `limit` pets.\n\n### Paging\n\nPass the `X-Next` of one page as `after` to get the page that follows.\n\n## Parameters\n',
    )
    // In the overview too, where a description is often a small document of its own.
    expect(source(petstore(), 'index')).toContain('\n### Errors\n\nEvery error has a `code` and a `message`.\n\n## Base URL\n')
  })

  it('list parameters in a table for each place, with what a parameter allows said in its description', () => {
    const api = petstore()
    const listed = section(source(api, 'pets/list-pets'), 'Parameters')
    expect(listed).toContain(
      `### Query parameters\n\n${HEAD}` +
        '| `limit` | `integer (int32)` | no | How many pets to return. At least 1. At most 100. Default: `20`. |\n' +
        '| `status` | `string` | yes | Only pets with this status. One of `available`, `pending`, `sold`. Example: `available`. |\n' +
        '| `tags` | `array of string` | no | Only pets with all of these tags. Its values are separated by commas. |\n',
    )
    // A parameter the operation refers to is read from where it is kept.
    expect(listed).toContain(`### Header parameters\n\n${HEAD}| \`X-Request-Id\` | \`string (uuid)\` | no | Sent back with the response, to tell requests apart. |\n`)
    // A parameter of the path is a parameter of every operation under it.
    for (const slug of ['pets/get-pet', 'pets/replace-pet', 'pets/delete-pets-pet-id']) {
      expect(section(source(api, slug), 'Parameters'), slug).toBe(`## Parameters\n\n### Path parameters\n\n${HEAD}| \`petId\` | \`integer (int64)\` | yes | The id of the pet. |\n`)
    }
    expect(source(api, 'pets/add-pet')).not.toContain('## Parameters')
  })

  it('have an operation say a parameter of its path over again, and say how a list or an object is sent', () => {
    const api = generateApiPages({
      openapi: '3.0.3',
      info: { title: 'One' },
      paths: {
        '/thing': {
          parameters: [
            { name: 'ids', in: 'query', description: 'The path says this.', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
          ],
          get: {
            operationId: 'thing',
            parameters: [
              { name: 'ids', in: 'query', description: 'The operation says more.', schema: { type: 'array', items: { type: 'integer' } } },
              { name: 'filter', in: 'query', style: 'deepObject', schema: { type: 'object', properties: { state: { type: 'string', enum: ['open', 'shut'] } } } },
              { name: 'point', in: 'query', content: { 'application/json': { schema: { type: 'object' } } } },
              // Said elsewhere, by the content types: OpenAPI has a parameter of this name ignored.
              { name: 'Accept', in: 'header', schema: { type: 'string' } },
              { name: 'old', in: 'body', schema: {} },
            ],
            responses: {},
          },
        },
      },
    })
    expect(section(source(api, 'thing'), 'Parameters')).toBe(
      `## Parameters\n\n### Query parameters\n\n${HEAD}` +
        '| `ids` | `array of integer` | no | The operation says more. Repeat the parameter for each value. |\n' +
        '| `page` | `integer` | no |  |\n' +
        '| `filter` | `object` | no | Each field is written as `filter[field]`. |\n' +
        '| `filter.state` | `string` | no | One of `open`, `shut`. |\n' +
        '| `point` | `object` | no | Written as `application/json`. |\n',
    )
    expect(api.notes).toEqual(['The parameter `old` is in `body`, which is not a place OpenAPI 3 has, and was left out. First met in `GET /thing`.'])
  })

  it('describe a request body: its content type, its fields, and an example', () => {
    const body = section(source(petstore(), 'pets/add-pet'), 'Request body')
    expect(body).toContain('## Request body\n\nThe pet to add.\n\nContent type: `application/json`. The body is required.\n\n' + FIELDS)
    expect(body).toContain('| `name` | `string` | yes | What the pet answers to. At least 1 character. Example: `Rex`. |\n')
    expect(body).toContain('| `tags` | `array of string` | no | Words to find the pet by. |\n')
    // The example is the one the description gives.
    expect(body).toContain('```json title="Example"\n{\n  "name": "Rex",\n  "kind": {\n    "species": "dog",\n    "goodBoy": true\n  },\n  "tags": [\n    "friendly"\n  ]\n}\n```')
  })

  it('name a field inside another parent.child, and the items of a list with []', () => {
    const api = petstore()
    expect(section(source(api, 'pets/add-pet'), 'Request body')).toContain(
      '| `owner` | `object` | no |  |\n' +
        '| `owner.name` | `string` | no |  |\n' +
        '| `owner.address` | `object` | no |  |\n' +
        '| `owner.address.city` | `string` | no |  |\n' +
        '| `owner.address.country` | `string` | no | As two letters. Exactly 2 characters. |\n',
    )
    // A body that is a list says so, since no row of the table can.
    const listed = section(source(api, 'pets/list-pets'), 'Responses')
    expect(listed).toContain('Content type: `application/json`. Type: `array of object`.\n\n' + FIELDS + '| `[].name` | `string` | yes |')
    expect(listed).toContain('| `[].owner.address.city` | `string` | no |  |\n')

    // The items of a list get a line of their own when there is something to say of them, and a map is named by `*`.
    const { page } = response({
      type: 'object',
      properties: {
        sizes: { type: 'array', items: { type: 'string', enum: ['s', 'm', 'l'] } },
        labels: { type: 'object', additionalProperties: { type: 'string', description: 'A label.' } },
      },
    })
    expect(page).toContain('| `sizes` | `array of string` | no |  |\n| `sizes[]` | `string`, one of `s`, `m`, `l` |  |  |\n| `labels` | `object` | no |  |\n| `labels.*` | `string` |  | A label. |\n')
  })

  it('put the parts of an allOf together, and leave out of a request what only a response has', () => {
    const api = petstore()
    // `Pet` is `NewPet` and two fields more. One of the two is `readOnly`.
    const stored = section(source(api, 'pets/get-pet'), 'Responses')
    expect(stored).toContain('| `id` | `integer (int64)` | yes | Given by the store. |\n| `status` | `string`, one of `available`, `pending`, `sold` | yes | Default: `available`. |\n')
    expect(stored).toContain('| `name` | `string` | yes | What the pet answers to.')

    const sent = section(source(api, 'pets/replace-pet'), 'Request body')
    expect(sent).toContain('| `status` | `string`, one of `available`, `pending`, `sold` | yes | Default: `available`. |\n')
    expect(sent).not.toContain('`id`')
    expect(sent).not.toContain('"id"')
    expect(stored).toContain('"id": 0')
  })

  it('list the alternatives of a oneOf, each in a table of its own', () => {
    const body = section(source(petstore(), 'pets/add-pet'), 'Request body')
    expect(body).toContain('| `kind` | `Dog or Cat` | yes | What sort of animal it is. `species` says which it is. |\n')
    expect(body).toContain(`\`kind\` as \`Dog\`:\n\n${FIELDS}| \`kind.species\` | \`string\`, always \`dog\` | yes |  |\n| \`kind.goodBoy\` | \`boolean\` | no |  |\n`)
    expect(body).toContain(`\`kind\` as \`Cat\`:\n\n${FIELDS}| \`kind.species\` | \`string\`, always \`cat\` | yes |  |\n| \`kind.lives\` | \`integer\` | no | At most 9. |\n`)

    // Alternatives that are not objects need no table: the type says it all. One with no name is numbered.
    const { page } = response({ anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'object', properties: { a: { type: 'string' } } }] })
    expect(page).toContain('Content type: `application/json`. Type: `string or integer or object`.\n\nAlternative 3:\n\n' + FIELDS + '| `a` | `string` | no |  |\n')
  })

  it('read both ways of saying that a value may be null', () => {
    const api = petstore()
    // 3.1: `null` among the types, and `null` as one of two alternatives.
    expect(source(api, 'pets/add-pet')).toContain('| `bornOn` | `string (date) or null` | no | The day it was born, when that is known. |\n')
    expect(source(api, 'store/list-categories')).toContain('| `[].parent` | `object or null` | no | The category this one is in.')
    // 3.0: `nullable`, which is also where a limit that is itself not allowed is said with `true`.
    const { page } = response({ type: 'object', properties: { nick: { type: 'string', nullable: true }, age: { type: 'integer', minimum: 0, exclusiveMinimum: true } } })
    expect(page).toContain('| `nick` | `string or null` | no |  |\n| `age` | `integer` | no | More than 0. |\n')
  })

  it('stop at a schema that holds itself, and say where its fields are', () => {
    const page = source(petstore(), 'store/list-categories')
    expect(page).toContain(
      FIELDS +
        '| `[].name` | `string` | yes |  |\n' +
        '| `[].parent` | `object or null` | no | The category this one is in. The fields are listed at the top level, and not again here. |\n' +
        '| `[].children` | `array of object` | no | The fields are listed at the top level, and not again here. |\n',
    )
    // The example stops at the same place.
    expect(page).toContain('```json title="Example"\n[\n  {\n    "name": "string",\n    "children": []\n  }\n]\n```')

    // A schema that is used twice, without holding itself, is listed where it is met first.
    const money = { $ref: '#/components/schemas/Money' }
    const twice = response({ type: 'object', properties: { price: money, tax: money } }, { components: { schemas: { Money: { type: 'object', properties: { amount: { type: 'integer' } } } } } })
    expect(twice.page).toContain('| `price` | `object` | no |  |\n| `price.amount` | `integer` | no |  |\n| `tax` | `object` | no | The fields are listed at `price`, and not again here. |\n')
  })

  it('stop below six levels and after five hundred fields, and say so on the page and in the notes', () => {
    let deep: unknown = { type: 'string' }
    for (let level = 8; level > 0; level--) deep = { type: 'object', properties: { [`level${level}`]: deep } }
    const nested = response(deep)
    expect(nested.page).toContain('| `level1.level2.level3.level4.level5.level6` | `object` | no | What is inside is more than 6 levels deep, and is not listed. |\n')
    expect(nested.page).not.toContain('level7')
    expect(nested.api.notes).toEqual(['In the response `200` of `GET /thing`, fields more than 6 levels deep are not listed.'])

    const wide = response({ type: 'object', properties: Object.fromEntries(Array.from({ length: 600 }, (_, n) => [`field${n}`, { type: 'string' }])) })
    expect(wide.page).toContain('| `field499` | `string` | no |  |\n\nThe schema has more fields than these. The tables stop at 500 lines.\n')
    expect(wide.page).not.toContain('`field500`')
    expect(wide.api.notes).toEqual(['In the response `200` of `GET /thing`, the schema has more than 500 fields. The table stops there.'])
  })

  it('take an example from the description, and make one from the schema where there is none', () => {
    const api = petstore()
    // Made: the example a field gives of itself, a default, the first allowed value, and a placeholder by type and format.
    expect(section(source(api, 'pets/add-pet'), 'Responses')).toContain(
      '```json title="Example"\n{\n  "name": "Rex",\n  "kind": {\n    "species": "dog",\n    "goodBoy": true\n  },\n  "tags": [\n    "string"\n  ],\n  "bornOn": "2025-01-01",\n' +
        '  "owner": {\n    "name": "string",\n    "address": {\n      "city": "string",\n      "country": "string"\n    }\n  },\n  "id": 0,\n  "status": "available"\n}\n```',
    )
    // Not JSON: the example is shown as the text it is.
    expect(source(api, 'get-health')).toContain('Content type: `text/plain`. Type: `string`.\n\n```text title="Example"\nok\n```')

    // The first of `examples`, and what 3.1 calls `examples` in a schema.
    const named = one({
      responses: {
        200: { description: 'Fine.', content: { 'application/json': { schema: { type: 'object' }, examples: { first: { value: { a: 1 } }, second: { value: { a: 2 } } } } } },
        201: { description: 'Made.', content: { 'application/json': { schema: { type: 'object', properties: { n: { type: 'integer', examples: [7, 8] }, when: { type: 'string', format: 'date-time' }, id: { type: 'string', format: 'uuid' } } } } } },
      },
    })
    expect(named.page).toContain('```json title="Example"\n{\n  "a": 1\n}\n```')
    expect(named.page).toContain('```json title="Example"\n{\n  "n": 7,\n  "when": "2025-01-01T12:00:00Z",\n  "id": "123e4567-e89b-12d3-a456-426614174000"\n}\n```')
  })

  it('end with a curl command made of the method, the address, what is required, the auth header and the body', () => {
    const api = petstore()
    // Of three query parameters, the one that is required.
    expect(section(source(api, 'pets/list-pets'), 'Example request')).toBe(
      "## Example request\n\n```sh title=\"curl\"\ncurl --request GET \\\n  --url 'https://api.petstore.example/v1/pets?status=available' \\\n  --header 'Authorization: Bearer <token>'\n```\n",
    )
    expect(section(source(api, 'pets/add-pet'), 'Example request')).toBe(
      "## Example request\n\n```sh title=\"curl\"\ncurl --request POST \\\n  --url 'https://api.petstore.example/v1/pets' \\\n  --header 'Authorization: Bearer <token>' \\\n  --header 'Content-Type: application/json' \\\n" +
        '  --data-raw \'{\n  "name": "Rex",\n  "kind": {\n    "species": "dog",\n    "goodBoy": true\n  },\n  "tags": [\n    "friendly"\n  ]\n}\'\n```\n',
    )
    // No auth where none is needed. A parameter of the path with no value to its name stays as it is written,
    // and curl is told not to take the braces for a pattern.
    expect(section(source(api, 'pets/get-pet'), 'Example request')).toBe(
      "## Example request\n\n```sh title=\"curl\"\ncurl --request GET \\\n  --globoff \\\n  --url 'https://api.petstore.example/v1/pets/{petId}'\n```\n",
    )
  })

  it('send a form, a file and a header the way curl has for each', () => {
    const parameters = [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'a b/c' },
      { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'session', in: 'cookie', required: true, schema: { type: 'string' }, example: 'abc' },
      { name: 'ids', in: 'query', required: true, explode: false, schema: { type: 'array', items: { type: 'integer' } }, example: [1, 2] },
    ]
    const curl = (operation: Record<string, unknown>) => {
      const api = generateApiPages({ openapi: '3.0.3', info: { title: 'One' }, paths: { '/things/{id}': { post: { operationId: 'thing', parameters, responses: {}, ...operation } } } })
      return section(source(api, 'thing'), 'Example request').split('\n').slice(3, -2).join('\n')
    }
    // A value in the path or the query is written as an address has it, and what goes in a header or a cookie as it is.
    const start = "curl --request POST \\\n  --url '/things/a%20b%2Fc?ids=1%2C2' \\\n  --header 'Idempotency-Key: 123e4567-e89b-12d3-a456-426614174000'"
    const cookie = " \\\n  --cookie 'session=abc'"

    expect(curl({})).toBe(start + cookie)
    // The fields of a form, one option each. curl says the content type of a form itself.
    const form = { type: 'object', properties: { 'full name': { type: 'string', example: "O'Neil & co" }, tags: { type: 'array', items: { type: 'string' }, example: ['a', 'b'] } } }
    expect(curl({ requestBody: { content: { 'application/x-www-form-urlencoded': { schema: form } } } })).toBe(
      `${start}${cookie} \\\n  --data-urlencode 'full%20name=O'\\''Neil & co' \\\n  --data-urlencode 'tags=a' \\\n  --data-urlencode 'tags=b'`,
    )
    const upload = { type: 'object', properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string', example: 'hello' } } }
    expect(curl({ requestBody: { content: { 'multipart/form-data': { schema: upload } } } })).toBe(`${start}${cookie} \\\n  --form 'file=@path/to/file' \\\n  --form-string 'note=hello'`)
    expect(curl({ requestBody: { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } } })).toBe(
      `${start} \\\n  --header 'Content-Type: application/octet-stream'${cookie} \\\n  --data-binary '@path/to/file'`,
    )

    // HEAD has an option of its own: asked for by name, curl would wait for a body that never comes.
    const head = generateApiPages({ openapi: '3.0.3', info: { title: 'One' }, paths: { '/thing': { head: { responses: {} } } } })
    expect(source(head, 'head-thing')).toContain("```sh title=\"curl\"\ncurl --head \\\n  --url '/thing'\n```")
  })

  it('take the servers of an operation before those of its path, and those before the servers of the document', () => {
    const at = (url: string) => ({ servers: [{ url }] })
    const api = generateApiPages({
      openapi: '3.0.3',
      info: { title: 'Servers' },
      servers: [{ url: 'https://{region}.example.com/{base}/', variables: { region: { default: 'eu', enum: ['eu', 'us'] }, base: { default: 'v2' } } }],
      paths: {
        '/a': { get: { operationId: 'a', responses: {} } },
        '/b': { ...at('https://b.example.com'), get: { operationId: 'b', responses: {} }, post: { operationId: 'c', ...at('https://c.example.com'), responses: {} } },
      },
    })
    // A variable is filled in with its default, and a slash at the end is not doubled.
    expect(frontmatter(source(api, 'a')).api?.baseUrl).toBe('https://eu.example.com/v2')
    expect(frontmatter(source(api, 'b')).api?.baseUrl).toBe('https://b.example.com')
    expect(frontmatter(source(api, 'c')).api?.baseUrl).toBe('https://c.example.com')
    expect(source(api, 'c')).toContain("--url 'https://c.example.com/b'")
    expect(source(api, 'index')).toContain(
      '## Base URL\n\n`https://eu.example.com/v2`\n\nWritten `https://{region}.example.com/{base}/` in the description: `region` is `eu` here and can be `us`; `base` is `v2` here.\n',
    )
    // With no server there is no address to give, and the command has the path alone.
    expect(frontmatter(one({ responses: {} }).page).api?.baseUrl).toBeUndefined()
  })

  it('say what a caller shows to be let in, from the security schemes', () => {
    const securitySchemes = {
      key: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      inQuery: { type: 'apiKey', in: 'query', name: 'api_key' },
      inCookie: { type: 'apiKey', in: 'cookie', name: 'sid' },
      basic: { type: 'http', scheme: 'basic' },
      oauth: {
        type: 'oauth2',
        description: 'For apps that act for a person.',
        flows: { authorizationCode: { authorizationUrl: 'https://example.com/authorize', tokenUrl: 'https://example.com/token', scopes: { 'pets:read': 'See pets', 'pets:write': 'Change pets' } } },
      },
    }
    const page = (security: unknown) => one({ security, responses: {} }, { components: { securitySchemes }, security: [{ key: [] }] }).page
    const auth = (security: unknown) => frontmatter(page(security)).api?.auth

    expect(auth(undefined)).toBe('API key in the X-API-Key header')
    expect(page(undefined)).toContain("--header 'X-API-Key: <api-key>'")
    expect(auth([{ inQuery: [] }])).toBe('API key in the api_key query parameter')
    expect(page([{ inQuery: [] }])).toContain("--url '/thing?api_key=<api-key>'")
    expect(auth([{ inCookie: [] }])).toBe('API key in the sid cookie')
    expect(page([{ inCookie: [] }])).toContain("--cookie 'sid=<api-key>'")
    expect(auth([{ basic: [] }])).toBe('HTTP Basic')
    expect(page([{ basic: [] }])).toContain("--user '<username>:<password>'")
    expect(auth([{ oauth: ['pets:read', 'pets:write'] }])).toBe('OAuth 2.0 with the scopes pets:read, pets:write')
    expect(page([{ oauth: ['pets:read'] }])).toContain("--header 'Authorization: Bearer <token>'")
    // Two schemes at once, or one way in or another, or nothing at all if the caller prefers.
    expect(auth([{ key: [], basic: [] }])).toBe('API key in the X-API-Key header and HTTP Basic')
    expect(auth([{ key: [] }, { basic: [] }, {}])).toBe('API key in the X-API-Key header, or HTTP Basic, or none')
    expect(auth([])).toBe('none')

    expect(section(source(one({ responses: {} }, { components: { securitySchemes }, security: [{ key: [] }] }).api, 'index'), 'Authentication')).toBe(
      '## Authentication\n\nUnless its page says otherwise, an operation needs: API key in the X-API-Key header.\n\n' +
        '- `key`: API key in the X-API-Key header.\n' +
        '- `inQuery`: API key in the api_key query parameter.\n' +
        '- `inCookie`: API key in the sid cookie.\n' +
        '- `basic`: HTTP Basic. Send `Authorization: Basic` and then the user name and the password, joined by a colon and written in Base64.\n' +
        '- `oauth`: OAuth 2.0. Send `Authorization: Bearer <token>`. For apps that act for a person.\n' +
        '  - Authorization code flow: authorise at `https://example.com/authorize`, get a token from `https://example.com/token`.\n' +
        '  - Scopes: `pets:read` (See pets), `pets:write` (Change pets).\n',
    )
  })

  it('give the overview the version, the base address, how to get in, and a link to every operation', () => {
    const page = source(petstore(), 'index')
    expect(frontmatter(page)).toMatchObject({ title: 'Petstore', description: 'Keeps track of the pets in a store, and of who they belong to.', editLink: false })
    expect(frontmatter(page).layout).toBeUndefined()
    expect(page).toContain('---\n\nVersion `1.2.0`.\n\nKeeps track of the pets in a store, and of who they belong to.\n')
    expect(page).toContain('## Base URL\n\n`https://api.petstore.example/v1`\n\nProduction\n')
    expect(page).toContain(
      '## Authentication\n\nUnless its page says otherwise, an operation needs: Bearer token (JWT).\n\n- `bearerAuth`: Bearer token (JWT). Send `Authorization: Bearer <token>`. A token from the dashboard.\n',
    )
    expect(section(page, 'Operations')).toBe(
      '## Operations\n\n### Pets\n\nThe animals themselves.\n\n' +
        '- [List pets](./pets/list-pets.md): `GET /pets`\n' +
        '- [Add a pet](./pets/add-pet.md): `POST /pets`\n' +
        '- [Get a pet](./pets/get-pet.md): `GET /pets/{petId}`\n' +
        '- [Replace a pet](./pets/replace-pet.md): `PUT /pets/{petId}`\n' +
        '- [Remove a pet](./pets/delete-pets-pet-id.md): `DELETE /pets/{petId}` (deprecated)\n\n' +
        '### Store\n\nWhat the store sorts its pets into.\n\n- [List categories](./store/list-categories.md): `GET /store/categories`\n\n' +
        '### Other\n\n- [GET /health](./get-health.md): `GET /health`\n',
    )
  })

  it('take a slug from the operationId, or from the method and path, and keep slugs apart', () => {
    const operation = (operationId?: string, tag?: string) => ({ ...(operationId ? { operationId } : {}), ...(tag ? { tags: [tag] } : {}), responses: {} })
    const api = generateApiPages({
      openapi: '3.1.0',
      info: { title: 'Slugs' },
      tags: [{ name: 'Second tag' }, { name: 'First: the "tag"' }, { name: 'Unused' }],
      paths: {
        '/a': { get: operation('getHTTPStatus_v2', 'First: the "tag"'), post: operation('getHttpStatusV2', 'First: the "tag"'), put: operation('Café.Crème', 'Second tag') },
        '/b/{userId}/c': { get: operation(undefined, 'Second tag'), post: operation('index'), put: operation('../../etc/passwd'), patch: operation('!!!', 'Undeclared'), delete: operation('CON') },
        '/': { get: operation('x'.repeat(300)) },
      },
    })
    // Groups in the order the tags are declared, then a tag that is only used, then the operations with none.
    expect(api.groups).toEqual([
      { label: 'Second tag', slugs: ['second-tag/cafe-creme', 'second-tag/get-b-user-id-c'] },
      { label: 'First: the "tag"', slugs: ['first-the-tag/get-http-status-v2', 'first-the-tag/get-http-status-v2-2'] },
      { label: 'Undeclared', slugs: ['undeclared/patch-b-user-id-c'] },
      // `index` is the overview, and `con` is not a file name Windows can have.
      { label: 'Other', slugs: ['index-2', 'etc-passwd', 'con-2', 'x'.repeat(80)] },
    ])
    const slugs = api.pages.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/)

    // With no tags at all, the one group is not called "Other", and the overview gives it no heading.
    const plain = generateApiPages({ openapi: '3.1.0', info: { title: 'Plain' }, paths: { '/a': { get: operation() } } })
    expect(plain.groups).toEqual([{ label: 'Operations', slugs: ['get-a'] }])
    expect(section(source(plain, 'index'), 'Operations')).toBe('## Operations\n\n- [GET /a](./get-a.md): `GET /a`\n')
  })

  it('note what they leave out', () => {
    expect(petstore().notes).toEqual([
      'The description has webhooks, which are not shown: `petAdopted`.',
      '`xml` in a schema is not used: the names and attributes a value has as XML are not shown. First met in the response `default` of `GET /pets`.',
      '`$ref: ./errors.yaml#/components/schemas/Help` leads to another file or address, which is not read. First met in the response `default` of `GET /pets`.',
      '`POST /pets` has callbacks, which are not shown: `onAdopted`.',
      'In the response `201` of `POST /pets`, links are not shown: `GetPetById`.',
    ])
    // What the reference led to is not known, and the page says so where it would have been.
    expect(source(petstore(), 'pets/get-pet')).toContain('| `help` | `unknown` | no | Its schema is `./errors.yaml#/components/schemas/Help`, which could not be read. |\n')

    const { api, page } = one({
      requestBody: { $ref: 'https://example.com/bodies.yaml#/Thing' },
      parameters: [{ $ref: '#/components/parameters/Gone' }],
      responses: { 200: { $ref: './responses.yaml#/Fine' }, 404: { description: 'Not there.', content: { 'application/json': { schema: { not: { type: 'string' } } } } } },
    })
    expect(api.notes).toEqual([
      '`$ref: #/components/parameters/Gone` leads to nothing in the description. First met in a parameter of `GET /thing`.',
      '`$ref: https://example.com/bodies.yaml#/Thing` leads to another file or address, which is not read. First met in the request body of `GET /thing`.',
      '`$ref: ./responses.yaml#/Fine` leads to another file or address, which is not read. First met in the response `200` of `GET /thing`.',
      '`not` in a schema is not shown. First met in the response `404` of `GET /thing`.',
    ])
    expect(page).toContain('## Request body\n\nThis is described at `https://example.com/bodies.yaml#/Thing`, which could not be read.\n')
    expect(page).toContain('### 200\n\nThis is described at `./responses.yaml#/Fine`, which could not be read.\n')

    const traced = generateApiPages({ openapi: '3.0.3', info: { title: 'Trace' }, paths: { '/debug': { trace: { responses: {} }, get: { responses: {} } } } })
    expect(traced.pages.map((page) => page.slug)).toEqual(['index', 'get-debug'])
    expect(traced.notes).toEqual(['`TRACE /debug` was left out: the request line of a page has no TRACE.'])
  })

  it('are made of whatever part of a description can be read, and never fail on the rest', () => {
    for (const odd of [{}, { paths: [], info: 'x', components: 7, tags: 'a', servers: {}, security: 'none' }, { paths: { '/a': null, '/b': { get: 'x', post: { parameters: 'x', responses: 7, requestBody: [] } } } }]) {
      const api = generateApiPages({ openapi: '3.1.0', ...odd })
      expect(api.title).toBe('API reference')
      expect(api.pages[0]?.slug).toBe('index')
    }

    // A format or a keyword named like something every object has is a name and no more.
    const { page } = response(JSON.parse('{ "type": "object", "properties": { "a": { "type": "string", "format": "constructor", "__proto__": { "type": "integer" } } } }'))
    expect(page).toContain('| `a` | `string (constructor)` | no |  |\n')
    expect(page).toContain('```json title="Example"\n{\n  "a": "string"\n}\n```')
  })

  it('refuse a document that is not OpenAPI 3.0 or 3.1, and say to convert Swagger', () => {
    const swagger = failure(() => generateApiPages({ swagger: '2.0', info: { title: 'Old' }, paths: {} }))
    expect(swagger.issues).toEqual([
      { path: ['swagger'], message: 'This is an OpenAPI 2.0 description, which is also called Swagger. Shabd reads OpenAPI 3.0 and 3.1. Convert the description to OpenAPI 3 first.' },
    ])
    expect(failure(() => generateApiPages({ openapi: '3.2.0' })).issues).toEqual([{ path: ['openapi'], message: 'This is OpenAPI 3.2.0. Shabd reads OpenAPI 3.0 and 3.1.' }])
    expect(failure(() => generateApiPages({ info: {} })).issues[0]?.message).toBe('This is not an OpenAPI description: it has no `openapi` version. Shabd reads OpenAPI 3.0 and 3.1.')
    for (const nothing of [null, undefined, 'openapi: 3.1.0', [], 3]) expect(failure(() => generateApiPages(nothing)).issues[0]?.message).toContain('This is not an OpenAPI description')
    // `openapi: 3.0` and `openapi: 3.1` without quotes are numbers by the time YAML has read them.
    for (const version of ['3.0.0', '3.0.3', '3.1.0', '3.1', 3, 3.1]) expect(generateApiPages({ openapi: version }).pages).toHaveLength(1)
  })
})

describe('a site with generated pages', () => {
  it('takes every page: each one compiles, and no link between them is broken', async () => {
    const { context, pages } = await inSite(petstore())
    expect(pages.map(({ page }) => page.path)).toEqual([
      '/api',
      '/api/get-health',
      '/api/pets/add-pet',
      '/api/pets/delete-pets-pet-id',
      '/api/pets/get-pet',
      '/api/pets/list-pets',
      '/api/pets/replace-pet',
      '/api/store/list-categories',
    ])
    expect(await collectProblems(context)).toEqual({ problems: [], detailed: [] })

    // The overview links to every other page, by the path of its file.
    const [overview, ...operations] = pages
    expect([...overview!.compiled.links].sort()).toEqual(operations.map(({ page }) => page.path))

    const listed = pages.find(({ page }) => page.path === '/api/pets/list-pets')!
    expect(listed.page.title).toBe('List pets')
    expect(listed.page.frontmatter.layout).toBe('api')
    // The outline: the headings of the page, with the description's own under none of them.
    expect(listed.compiled.toc.map((entry) => `${entry.depth} ${entry.text}`)).toEqual([
      '3 Paging',
      '2 Parameters',
      '3 Query parameters',
      '3 Header parameters',
      '2 Responses',
      '3 200',
      '3 default',
      '2 Example request',
    ])
    expect(listed.html).toContain('<td><code>status</code></td><td><code>string</code></td><td>yes</td><td>Only pets with this status. One of <code>available</code>, <code>pending</code>, <code>sold</code>. Example: <code>available</code>.</td>')
    expect(listed.html).toContain('data-lang="sh" data-title="curl"')
  })

  it('has in the Markdown copy of a page what an agent needs to make the request, with the frontmatter gone', async () => {
    const { context } = await inSite(petstore())
    const copy = pageMarkdown(context.store.byPath('/api/pets/add-pet')!)
    expect(copy.startsWith('# Add a pet\n\n## Request body\n')).toBe(true)
    expect(copy).toContain("curl --request POST \\\n  --url 'https://api.petstore.example/v1/pets' \\\n  --header 'Authorization: Bearer <token>' \\\n  --header 'Content-Type: application/json' \\\n  --data-raw '{")
    expect(copy).not.toContain('layout: api')
  })

  it('would take the same pages as MDX, and show the same', async () => {
    const { pages } = await inSite(petstore())
    for (const { page, html, mdx } of pages) expect(mdx, page.path).toBe(html)
  })
})

describe('text that was not written with a page in mind', () => {
  const EVIL = '<script>alert(1)</script>'
  /** A schema that holds itself as an object in memory, the way a YAML alias makes one, with no `$ref` to stop at. */
  const self: Record<string, any> = { type: 'object', description: 'Holds itself.', properties: {} }
  self.properties.again = self
  self.properties.list = { type: 'array', items: self }

  const HOSTILE = {
    openapi: '3.0.3',
    info: {
      title: `Evil "API": # yes | no ${EVIL}`,
      version: '1.0 | <b>',
      description: [
        `Intro with ${EVIL}, {braces}, {{name}}, a | pipe, $5 and $10, <b>bold</b> and <https://example.com/{id}>.`,
        '# Parameters',
        'import everything from "somewhere"',
        '<!-- a private note -->',
        '![relative](./images/flow.png) ![data](data:image/png;base64,AAAA)',
        '    { "indented": "{{name}}" }',
        '```jsx live title="x"\nexport default () => <b>{1 + 1}</b>',
      ].join('\n\n'),
    },
    servers: [{ url: `https://{region}.example.com/v1'; rm -rf /; '/`, description: `Main | ${EVIL}`, variables: { region: { default: 'eu', enum: ['eu', 'us|west'] } } }],
    security: [{ key: [] }, { 'o|auth': ['read:{{name}}', '<b>'] }, {}],
    tags: [{ name: '<b>Tag</b> | {x}', description: `## Responses\n\nTag text with ${EVIL}\n\n\`\`\`\nnever closed` }, { name: 'index' }, { name: '日本語' }],
    externalDocs: { url: 'javascript:alert(1)', description: 'bad ] link' },
    paths: {
      "/items/{item id}/a|b'c": {
        parameters: [
          { name: 'item id', in: 'path', required: true, description: 'An id | with a pipe\nand a second line.', schema: { type: 'string', pattern: '^(a\\|b)$', default: 'a|b`c\nd' } },
          // `JSON.parse`, because written here `__proto__` would not be a property at all.
          { name: 'filter[status]', in: 'query', required: true, style: 'deepObject', schema: JSON.parse('{ "type": "object", "properties": { "__proto__": { "type": "string" }, "a.b": { "type": "integer" } } }') },
          { name: 'na`me', in: 'query', required: true, schema: { type: 'string', enum: ['', ' ', '|', '`', '{{name}}', null, true, 1.5, { a: 1 }, ['x']] } },
          { name: '<img src=x onerror=alert(1)>', in: 'header', required: true, description: `${EVIL} {x} $1$`, schema: { type: 'weird', format: EVIL } },
          { name: '@/etc/passwd', in: 'header', required: true, schema: { type: 'string' } },
          { name: '{{name}}', in: 'cookie', required: true, schema: { type: 42 }, example: "it's {{name}}" },
          { name: 'line\nbreak', in: 'query', schema: { type: 'array', items: { type: 'string' } }, style: 'pipeDelimited' },
          'not a parameter',
        ],
        get: {
          operationId: '../../etc/passwd',
          tags: ['<b>Tag</b> | {x}'],
          summary: 'List\nitems | all: `yes` <b> {{name}} [x](y) #1',
          description: `Text with ${EVIL} and {braces}.\n\n## Request body\n\n| a | b |\n| - | - |\n| {x} | <i> |`,
          externalDocs: { url: 'https://example.com/docs?a=(1)&b={2}', description: 'Read ] more [' },
          responses: {
            200: {
              description: 'Fine.\n\n# Deep\n\n```json\n{ "unclosed": true }',
              headers: { 'X-Rate|Limit': { description: 'How many | are left', schema: { type: 'integer' } } },
              content: {
                'application/json; charset="utf-8"': {
                  schema: { $ref: '#/components/schemas/Loop' },
                  examples: { one: { externalValue: 'https://example.com/one.json' }, two: { value: { text: "```\nfence ``` and {{name}} and 'quote'", html: `</script>${EVIL}` } } },
                },
                [`text/${EVIL}`]: { schema: { type: 'string' } },
              },
            },
            [EVIL]: { description: EVIL },
            '2XX': { description: 'Any success', content: { 'application/xml': { schema: { type: 'object', properties: { a: { type: 'string', xml: { attribute: true } } } }, example: '<x a="1">{{name}}</x>' } } },
          },
        },
        post: {
          operationId: '../../etc/passwd',
          tags: ['index'],
          requestBody: {
            description: `A form with ${EVIL}`,
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string', example: '@/etc/passwd' }, 'x=@/etc/passwd;y': { type: 'string', format: 'binary' } } },
              },
            },
          },
          responses: null,
        },
        put: { operationId: 'index', tags: ['日本語'], requestBody: { content: { 'text/plain': { schema: { type: 'string' }, example: '@/etc/passwd' } } }, responses: {} },
        delete: { security: [], requestBody: { content: { 'application/json': { schema: self } } }, responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Shape' } } } } } },
      },
    },
    components: {
      securitySchemes: {
        key: { type: 'apiKey', in: 'header', name: `X-Key'"; drop`, description: `Key | ${EVIL}` },
        'o|auth': {
          type: 'oauth2',
          description: '# Heading in a list item',
          flows: { authorizationCode: { authorizationUrl: 'https://example.com/auth?x={y}', tokenUrl: 'https://example.com/token', scopes: { 'read:{{name}}': `Read | ${EVIL}`, '<b>': 42 } } },
        },
      },
      schemas: {
        Loop: {
          allOf: [{ $ref: '#/components/schemas/Loop' }, { $ref: '#/components/schemas/Base' }],
          properties: {
            '': { type: 'string' },
            'pipe|name': { type: 'string', description: `A | b ${EVIL} {x} \`code | {y}\`\n\n- list\n- items`, enum: ['a|b', '`'] },
            self: { $ref: '#/components/schemas/Loop' },
            ring: { $ref: '#/components/schemas/RingA' },
            bool: true,
          },
          required: ['self', 42],
        },
        Base: { type: 'object', properties: { base: { type: ['integer', 'null', 7] }, 'pipe|name': { minLength: 1 } } },
        RingA: { $ref: '#/components/schemas/RingB' },
        RingB: { $ref: '#/components/schemas/RingA' },
        Shape: {
          oneOf: [{ $ref: '#/components/schemas/Shape' }, { type: 'object', title: 'Circle | <b>', properties: { r: { type: 'number' }, inner: { $ref: '#/components/schemas/Shape' } } }, { type: 'string' }],
          discriminator: { propertyName: 'kind|of' },
        },
      },
    },
  }

  it('is written as valid YAML and as Markdown that says the same and means nothing more', () => {
    const api = generateApiPages(HOSTILE)
    const slugs = api.pages.map((page) => page.slug)
    expect(slugs).toEqual(['index', 'b-tag-b-x/etc-passwd', 'index-2/etc-passwd', 'group/index-2', 'delete-items-item-id-a-b-c'])

    // Frontmatter comes back as it went in: a summary on one line, and everything else to the letter.
    expect(frontmatter(source(api, 'index')).title).toBe('Evil "API": # yes | no <script>alert(1)</script>')
    const listed = source(api, 'b-tag-b-x/etc-passwd')
    expect(frontmatter(listed)).toMatchObject({
      title: 'List items | all: `yes` <b> {{name}} [x](y) #1',
      description: 'Text with alert(1) and {braces}.',
      api: { path: "/items/{item id}/a|b'c", baseUrl: "https://eu.example.com/v1'; rm -rf /; '", auth: `API key in the X-Key'"; drop header, or OAuth 2.0 with the scopes read:{{name}}, <b>, or none` },
    })

    // HTML is shown as the text it is, and braces as braces.
    expect(listed).toContain('Text with \\<script>alert(1)\\</script> and \\{braces}.\n\n### Request body\n\n| a | b |\n| - | - |\n| \\{x} | \\<i> |\n')
    // In a table: a pipe is escaped wherever it is, a line break is a space, and what cannot be code is plain text.
    expect(listed).toContain('| `item id` | `string` | yes | An id \\| with a pipe and a second line. Matches ^(a\\\\\\|b)\\$. Default: ``"a\\|b`c\\nd"``. |\n')
    expect(listed).toContain('| `filter[status].__proto__` | `string` | no |  |\n| `filter[status].a.b` | `integer` | no |  |\n')
    expect(listed).toContain('| ``na`me`` | `string` | yes | One of `""`, `" "`, `\\|`, `` ` ``, \\{\\{name\\}\\}, `null`, `true`, `1.5`, `{"a":1}`, `["x"]`. |\n')
    expect(listed).toContain('| `<img src=x onerror=alert(1)>` | `weird (<script>alert(1)</script>)` | yes | \\<script>alert(1)\\</script> \\{x} \\$1\\$ |\n')
    expect(listed).toContain('| `X-Rate\\|Limit` | `integer` | no | How many \\| are left |\n')
    expect(listed).toContain('| `pipe\\|name` | `string`, one of `a\\|b`, `` ` `` | no | A \\| b \\<script>alert(1)\\</script> \\{x} `code \\| {y}` - list - items. At least 1 character. |\n| `""` | `string` | no |  |\n')
    // A heading of the description is below the heading it is under, and a code block left open is closed.
    expect(listed).toContain('### 200\n\nFine.\n\n#### Deep\n\n```json\n{ "unclosed": true }\n```\n\nHeaders:\n')
    expect(listed).toContain('### \\<script\\>alert(1)\\</script\\>\n\n\\<script>alert(1)\\</script>\n')
    // A fence is longer than any run of backticks in what it holds, and says when a variable must be left alone.
    expect(listed).toContain('````json title="Example" noVars\n{\n  "text": "```\\nfence ``` and {{name}} and \'quote\'",\n  "html": "</script><script>alert(1)</script>"\n}\n````')
    expect(listed).toContain('[Read \\] more \\[](https://example.com/docs?a=%281%29&b=%7B2%7D)')

    const overview = source(api, 'index')
    expect(overview).toContain(
      'Intro with \\<script>alert(1)\\</script>, \\{braces}, \\{\\{name}}, a | pipe, \\$5 and \\$10, \\<b>bold\\</b> and [https://example.com/\\{id\\}](https://example.com/%7Bid%7D).\n\n### Parameters\n\n&#105;mport everything from "somewhere"\n',
    )
    expect(overview).not.toContain('a private note')
    expect(overview).toContain('\nrelative data\n\n```text noVars\n{ "indented": "{{name}}" }\n```\n\n```jsx\nexport default () => <b>{1 + 1}</b>\n```\n\n## Base URL\n')
    expect(overview).not.toContain('javascript:')
    expect(overview).toContain('### \\<b\\>Tag\\</b\\> \\| \\{x\\}\n\n#### Responses\n\nTag text with \\<script>alert(1)\\</script>\n\n```\nnever closed\n```\n\n- [List items \\| all: \\`yes\\` \\<b\\> \\{\\{name\\}\\} \\[x\\](y) \\#1](./b-tag-b-x/etc-passwd.md)')

    expect(api.notes).toEqual([
      'A picture in a description has an address that leads nowhere from a page, and was left out: `./images/flow.png`. First met in the overview.',
      'A picture in a description has an address that leads nowhere from a page, and was left out: `data:image/png;base64,AAAA`. First met in the overview.',
      "`$ref: #/components/schemas/RingB` leads back to itself, so nothing could be read from it. First met in the response `200` of `GET /items/{item id}/a|b'c`.",
      "In the response `200` of `GET /items/{item id}/a|b'c`, the example `one` is kept at another address, and is not fetched.",
      "`xml` in a schema is not used: the names and attributes a value has as XML are not shown. First met in the response `2XX` of `GET /items/{item id}/a|b'c`.",
    ])
  })

  it('cannot make the curl command read a file, or run anything but curl', () => {
    const api = generateApiPages(HOSTILE)
    const command = (slug: string) => section(source(api, slug), 'Example request')
    // What is quoted stays quoted, and a header whose name is no header name is left out.
    expect(command('b-tag-b-x/etc-passwd')).toBe(
      '## Example request\n\n```sh title="curl" noVars\ncurl --request GET \\\n  --globoff \\\n' +
        "  --url 'https://eu.example.com/v1'\\''; rm -rf /; '\\''/items/a%7Cb%60c%0Ad/a|b'\\''c?filter[status][__proto__]=string&filter[status][a.b]=0&na%60me=' \\\n" +
        "  --cookie '{{name}}=it'\\''s {{name}}'\n```\n",
    )
    // A value that starts with `@` is sent as it is written, where curl would otherwise send the file of that name.
    expect(command('group/index-2')).toContain("  --header 'Content-Type: text/plain' \\\n  --cookie '{{name}}=it'\\''s {{name}}' \\\n  --data-raw '@/etc/passwd'\n```")
    expect(command('index-2/etc-passwd')).toContain("  --form 'file=@path/to/file' \\\n  --form-string 'note=@/etc/passwd' \\\n  --form-string 'x=@/etc/passwd;y=<file>'\n```")
    for (const page of api.pages) expect(page.source, page.slug).not.toMatch(/--(?:header|data|data-binary|form|data-urlencode) '[^'\n]*@\/etc/)
  })

  it('makes pages a site takes, with its variables and its maths left out of them', async () => {
    const config = 'site:\n  title: Docs\nvars:\n  name: SUBSTITUTED\n  x: ALSO\nmarkdown:\n  math: true\n'
    const { context, pages } = await inSite(generateApiPages(HOSTILE, { tryIt: true }), config)
    expect(pages).toHaveLength(5)
    expect(await collectProblems(context)).toEqual({ problems: [], detailed: [] })

    for (const { page, compiled, html, mdx } of pages) {
      // Nothing of the description is an element of the page: no script, no picture, no bold. The only
      // `div`s are the ones the api layout lays prose and code out in.
      expect(html.replace(/<div class="sb-split[a-z-]*">/g, ''), page.path).not.toMatch(/<(?:script|img|b|i|div)[\s>]/)
      expect(html, page.path).not.toContain('SUBSTITUTED')
      expect(html, page.path).not.toContain('ALSO')
      expect(html, page.path).not.toContain('class="katex"')
      // Every row of a table has the cells its heading has.
      for (const [, table] of html.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
        const cells = [...table!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => (row!.match(/<t[dh]>/g) ?? []).length)
        expect(new Set(cells).size, `${page.path}: ${cells.join(' ')}`).toBe(1)
      }
      // Whatever headings a description has, the `##` headings of the page are the generator's own.
      if (page.frontmatter.api) {
        expect(compiled.toc.filter((entry) => entry.depth === 2).map((entry) => entry.text).filter((text) => !['Parameters', 'Request body', 'Responses', 'Example request'].includes(text)), page.path).toEqual([])
      }
      expect(mdx, page.path).toBe(html)
    }

    const overview = pages[0]!
    expect(overview.compiled.toc.filter((entry) => entry.depth === 2).map((entry) => entry.text)).toEqual(['Base URL', 'Authentication', 'Operations'])
    expect(overview.html).toContain('Intro with &lt;script&gt;alert(1)&lt;/script&gt;, {braces}, {{name}}, a | pipe, $5 and $10, &lt;b&gt;bold&lt;/b&gt; and <a href="https://example.com/%7Bid%7D">https://example.com/{id}</a>.')
    expect(overview.html).toContain('<p>import everything from &quot;somewhere&quot;</p>')
  })
})

describe('a description in a file', () => {
  it('is read from YAML and from JSON, and makes the same pages either way', async () => {
    const dir = await site({ 'petstore.yaml': PETSTORE, 'petstore.json': `\uFEFF${JSON.stringify(parse(PETSTORE), null, 2)}` })
    const [yaml, json] = await Promise.all([readOpenApi(`${dir}/petstore.yaml`), readOpenApi(`${dir}/petstore.json`)])
    expect(json).toEqual(yaml)
    expect(generateApiPages(json)).toEqual(petstore())
  })

  it('has a mistake in it reported with its line', async () => {
    const dir = await site({
      'broken.yaml': 'openapi: 3.1.0\ninfo:\n  title: Broken\ninfo:\n  version: 1\n',
      'broken.json': '{\n  "openapi": "3.1.0",\n  "info": { "title": "Broken" }\n  "paths": {}\n}\n',
      'bare.json': '{\n  "openapi": "3.1.0",\n  "info": { "title": Broken }\n}\n',
      'lenient.json': '{\n  "openapi": "3.1.0",\n  "info": { "title": "Lenient", },\n}\n',
    })
    const yaml = await rejection(() => readOpenApi(`${dir}/broken.yaml`))
    expect(yaml.file).toBe(`${dir}/broken.yaml`)
    expect(yaml.issues).toEqual([{ message: 'Map keys must be unique', path: [], line: 4, column: 1 }])

    // JSON.parse does not always say where. The line comes from reading the file as the YAML it also is.
    const json = await rejection(() => readOpenApi(`${dir}/broken.json`))
    expect(json.issues).toEqual([{ message: 'Missing , between flow map items', path: [], line: 4, column: 3 }])
    expect(json.frame).toContain('"paths": {}')
    expect((await rejection(() => readOpenApi(`${dir}/bare.json`))).issues[0]).toMatchObject({ line: 3, column: 22, message: 'Unresolved plain scalar "Broken"' })
    // A comma after the last item is a mistake in JSON and none in YAML, so the file is read all the same.
    expect(await readOpenApi(`${dir}/lenient.json`)).toEqual({ openapi: '3.1.0', info: { title: 'Lenient' } })
  })

  it('is refused with the line that says what it is, when it is not OpenAPI 3.0 or 3.1', async () => {
    const dir = await site({
      'swagger.yaml': '# An old one.\nswagger: "2.0"\ninfo:\n  title: Old\n',
      'swagger.json': '{\n  "info": { "title": "Old" },\n  "swagger": "2.0"\n}\n',
      'next.yaml': 'info:\n  title: Next\nopenapi: 3.2.0\n',
      'notes.yaml': '- not\n- a description\n',
    })
    const swagger = await rejection(() => readOpenApi(`${dir}/swagger.yaml`))
    expect(swagger.file).toBe(`${dir}/swagger.yaml`)
    expect(swagger.issues).toEqual([
      {
        path: ['swagger'],
        message: 'This is an OpenAPI 2.0 description, which is also called Swagger. Shabd reads OpenAPI 3.0 and 3.1. Convert the description to OpenAPI 3 first.',
        line: 2,
        column: 1,
      },
    ])
    expect(swagger.frame).toContain('swagger: "2.0"')
    expect((await rejection(() => readOpenApi(`${dir}/swagger.json`))).issues[0]).toMatchObject({ path: ['swagger'], line: 3, column: 3 })
    expect((await rejection(() => readOpenApi(`${dir}/next.yaml`))).issues[0]).toMatchObject({ path: ['openapi'], line: 3, message: 'This is OpenAPI 3.2.0. Shabd reads OpenAPI 3.0 and 3.1.' })
    expect((await rejection(() => readOpenApi(`${dir}/notes.yaml`))).issues[0]?.message).toContain('This is not an OpenAPI description')
    expect((await rejection(() => readOpenApi(`${dir}/nowhere.yaml`))).issues[0]?.message).toBe(`There is no file at ${dir}/nowhere.yaml`)
  })
})

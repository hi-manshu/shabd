---
title: OpenAPI
description: The pages Shabd makes from an OpenAPI description, and what of a description they show.
---

Shabd reads an OpenAPI description and makes an API reference from it: an overview, and a page for each operation.
The pages are Markdown with frontmatter, the same as pages written by hand, and nothing else in Shabd knows where
they came from. So search finds them, `llms.txt` lists them, each has a Markdown copy, and the
[MCP tools](./mcp.md) read them. An agent that reads the page of an operation has what it needs to call it.

It reads OpenAPI 3.0 and 3.1, in YAML or JSON. A description in OpenAPI 2.0, which is also called Swagger, is
refused with a message that says to convert it first.

## Turning it on

Name the description in the config, and say where on the site its pages go:

```yaml title="shabd.config.yaml"
openapi:
  spec: ./openapi.yaml
  path: /api
```

| Key | Default | |
| --- | --- | --- |
| `spec` | | The description: a `.yaml`, `.yml` or `.json` file, by its path from the site folder. Required |
| `path` | `/api` | Where the pages are on the site. The overview is at this address and each operation under it |
| `try` | `false` | Put a [Try it](../configuration/frontmatter.md#trying-a-request) form on the page of every operation. Where the request has a JSON body, the form starts from its example |

A site with several APIs writes a list, and gives each a `path` of its own. One may not be inside another:

```yaml title="shabd.config.yaml"
openapi:
  - { spec: ./pets.yaml, path: /reference/pets }
  - { spec: ./orders.json, path: /reference/orders, try: true }
```

The pages are made when `shabd dev` or `shabd build` starts. While `shabd dev` runs they are made again each time
the description is saved, and the page on screen changes in place. A description that cannot be read is reported
with the line that is wrong. A build stops there. The dev server keeps the pages it had until the description
can be read again.

### Where the pages are

They are written as Markdown files to `.shabd/openapi/` in the site folder, laid out as the content folder is:
the pages of an API at `/api` are in `.shabd/openapi/api/`. They are there to be read, by Shabd and by you. An
edit to one is lost the next time the pages are made, so "Edit this page" is not offered on them and the
[Studio](./studio.md) does not open them. Keep `.shabd/` out of version control, as the starter's `.gitignore`
does.

A page of your own cannot have the address of a generated one. `content/api/index.md` and an API at `/api` are an
error that names both. Other pages in the same folder are fine.

The site's [variables](../guide/writing/markdown.md#variables) are not filled into these pages. A description is
somebody else's text, and braces in it are braces.

### In the sidebar

An API is laid out as its description has it: the overview, then a group for each tag with its operations in the
order they are written. A folder would give neither the tags' names nor that order.

- With nothing about it in `sidebar.yaml`, the API is added at the end like any
  [folder you did not mention](../configuration/sidebar.md#folders-you-did-not-mention), under the title the
  description gives it.
- `autogenerate` puts it under a heading of yours:

  ```yaml title="sidebar.yaml"
  - category: Reference
    autogenerate: api
  ```

- A large API is better with [a sidebar of its own](../configuration/sidebar.md#more-than-one-sidebar), so that
  the rest of the site does not carry it:

  ```yaml title="sidebar.yaml"
  /api/:
    - category: API
      autogenerate: api
  ```

- A page can also be listed by its path, as any page is: `api/pets/list-pets`.

A description with no tags has no groups, and its operations are listed under the overview.

### What check says

What a description holds that its pages cannot show is listed by [`shabd check`](../reference/cli.md), and after a
build, as notes against the description's file: the first twelve in full, and a count of the rest. They are under
[What is left out](#what-is-left-out) below.

## The pages

| Page | Named | Holds |
| --- | --- | --- |
| The overview | `index` | What the API is, where it is served, how a caller is let in, and a link to every operation |
| One for each operation | `pets/list-pets` | The request, its parameters and body, its responses, and a `curl` command |

A page's folder is the operation's first tag, and its name is the operation's `operationId`: `listPets` with the
tag `Pets` is `pets/list-pets`. An operation with no `operationId` is named from its method and path, so
`DELETE /pets/{petId}` is `delete-pets-pet-id`. An operation with no tag has no folder. A name is made of the
letters `a` to `z`, digits and hyphens, and of two operations that would share a name the second gets a number.

Operations are grouped by their first tag: the tags the description declares, in its order, then the tags it
only uses, then the operations with no tag.

## An operation

This operation:

```yaml title="openapi.yaml"
openapi: 3.1.0
info:
  title: Petstore
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
security:
  - bearerAuth: []
paths:
  /pets/{petId}:
    get:
      operationId: getPet
      tags: [Pets]
      summary: Get a pet
      description: Returns one pet. A pet that was removed is not found.
      parameters:
        - name: petId
          in: path
          required: true
          description: The id of the pet.
          schema: { type: integer }
          example: 42
      responses:
        '200':
          description: The pet.
          content:
            application/json:
              schema:
                type: object
                required: [id, name]
                properties:
                  id: { type: integer }
                  name: { type: string, example: Rex }
                  status: { type: string, enum: [available, sold] }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
```

becomes this page:

````md title="pets/get-pet.md"
---
title: Get a pet
description: Returns one pet.
layout: api
api:
  method: GET
  path: /pets/{petId}
  baseUrl: https://api.example.com/v1
  auth: Bearer token
  deprecated: false
editLink: false
---

Returns one pet. A pet that was removed is not found.

## Parameters

### Path parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `petId` | `integer` | yes | The id of the pet. Example: `42`. |

## Responses

### 200

The pet.

Content type: `application/json`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `integer` | yes |  |
| `name` | `string` | yes | Example: `Rex`. |
| `status` | `string`, one of `available`, `sold` | no |  |

```json title="Example"
{
  "id": 0,
  "name": "Rex",
  "status": "available"
}
```

## Example request

```sh title="curl"
curl --request GET \
  --url 'https://api.example.com/v1/pets/42' \
  --header 'Authorization: Bearer <token>'
```
````

### Frontmatter

`layout: api` and `api` are what the [`api` layout](../configuration/frontmatter.md#api) draws the request line
from.

| Key | Where it comes from |
| --- | --- |
| `title` | The operation's `summary`. Without one, its method and path: `GET /pets/{petId}` |
| `description` | The first sentence of the operation's `description`, as plain text |
| `api.method`, `api.path` | The operation |
| `api.baseUrl` | The first of `servers`, with each variable filled in by its default. An operation's own servers come before those of its path, and those before the document's |
| `api.auth` | What `security` asks for, in words: `Bearer token`, `API key in the X-API-Key header`, `OAuth 2.0 with the scopes read, write`, or `none` |
| `api.deprecated`, `badges` | A deprecated operation says so in both |
| `editLink` | `false`: the page has no file to edit |

### Body

In this order, each part only when the operation has it:

1. The description, kept as it is written. See [text from the description](#text-from-the-description).
2. **Parameters**, in a table for each place a parameter can be: path, query, header and cookie. What a
   parameter allows is said in its description: its values, its limits, its default, an example. The parameters of
   a path are listed with those of each operation under it.
3. **Request body**: the content type, a table of the fields, and an example.
4. **Responses**: a heading for each status, with its description, its headers, a table of the fields, and an
   example.
5. **Example request**: a `curl` command.

## Fields

A schema is shown as a table of its fields.

| In a table | Meaning |
| --- | --- |
| `owner.address.city` | A field inside a field |
| `tags[]` | The items of a list. They get a line of their own when there is more to say of them than their type |
| `labels.*` | The values of a map, which OpenAPI writes as `additionalProperties` |
| `string (date-time)` | A type with its `format` |
| `array of string` | A list |
| `string or null` | A value that may be null: `nullable` in 3.0, and `null` among the types in 3.1 |
| `string`, one of `a`, `b` | The values of an `enum`. The one value of a `const` is written "always" |
| `Cat or Dog` | The alternatives of a `oneOf` or an `anyOf`. Each alternative that has fields has a table of its own after the first, under a line such as "`pet` as `Cat`:" |

- `$ref` is followed within the document.
- The parts of an `allOf` are put together into one list of fields.
- A field that is `readOnly` is left out of a request body, and one that is `writeOnly` out of a response.
- A schema's fields are listed once in the tables of a body. Where the schema is met again, its line says where
  they are listed. That is also what ends a schema that holds itself.
- Fields more than six levels deep are not listed, and the tables of one schema stop at 500 lines. The page says
  so where it happens.

## Examples

An example is the one the description gives: `example`, or the first of `examples`. Where it gives none, one is
made from the schema. Each field takes its own example, or its default, or the first value it allows. A field
with none of those gets a placeholder by its type and format, such as `"string"`, `0` or `"2025-01-01"`.

A made example shows the shape of a value. It is not known to be a value the API accepts: a placeholder takes no
account of a `pattern` or of a length.

## The curl command

The command has the method, the whole address, the header that `security` asks for, the parameters that are
required, and the body with its content type. Parameters that are not required are left out of it.

- A parameter of the path is filled in when the description names a value for it: an example, a default, or a
  value it allows. When it names none, `{petId}` stays in the address as it is written.
- A form is sent one field to an option, with `--data-urlencode` or `--form-string`, and a field that is a file as
  `--form 'file=@path/to/file'`.
- Every value from the description is quoted for a shell and sent as it is written. `curl` reads a value that
  starts with `@` as the name of a file, so the options that do not are the ones used.

The page of an operation is also read as Markdown, by agents, and there the frontmatter is gone. The command is
what says how the request is made in that copy.

## Text from the description

Every `description` in an OpenAPI description is Markdown, and it is kept as it is written: paragraphs, lists,
links, tables, code. The description of a parameter or of a field is put on one line, since it stands in a table.

- **Headings** are moved down, so that they sit below the headings of the page. A `#` heading in the description
  of an operation becomes `###`.
- **HTML** is shown as the text it is: `<b>` is those three characters, and nothing is bold. A page written by
  hand drops HTML without a word, and here the reader sees what the description says. An HTML comment is left out.
- **Pictures** are shown when their address is a full one or starts with `/`. A picture with a relative path is
  left out, because there is no folder beside a generated page for it to be in. Its alternative text stays.
- **Code blocks** keep their language and lose what follows it, such as a title. A code block that is never closed
  is closed.
- **Braces and dollar signs** are escaped in the body of a page, so that neither
  [variables](../guide/writing/markdown.md#variables) nor [maths](../guide/writing/markdown.md#maths) change what
  a description says.

A `summary`, a name and a value are plain text, and are shown as they are written whatever characters they hold.

## The overview

The overview has the title of the API and its version, its description, and then:

- **Base URL**: the servers of the document. A server whose address has variables is shown with their defaults
  filled in, and with the other values each variable allows.
- **Authentication**: each security scheme, with what it is and how it is sent. An OAuth 2.0 scheme lists its
  flows with their addresses, and its scopes.
- **Operations**: every operation by group, with a link to its page.

## What is left out

Each of these is noted when it is met, with the place it was first met:

| In the description | What happens |
| --- | --- |
| A `$ref` to another file or address | It is not followed. A field is listed with the type `unknown` and the reference, a response or a body says where it is described, and a parameter is left out |
| Callbacks, webhooks, and the links of a response | Not shown |
| `xml` in a schema | Not used: the names and attributes a value has as XML are not shown |
| `not`, `if`, `then`, `else`, `patternProperties`, `propertyNames`, `dependentSchemas`, `dependentRequired`, `prefixItems`, `contains`, `unevaluatedProperties`, `unevaluatedItems` | Not shown |
| `encoding` in a request body | Not shown |
| An example kept at another address, with `externalValue` | Not fetched |
| An operation whose method is `TRACE` | Left out: the request line of a page has no TRACE |

These are left out without a note:

- A body or a response that has several content types is described in one of them, JSON where it is offered. The
  others are named on the page.
- The contact, the licence and the terms of service of the API.
- `discriminator.mapping`. The property that tells the alternatives apart is named.
- Keys of the description's own, which start with `x-`.

OpenAPI 3.2 is refused, like 2.0.

## Things to know

- The pages were made from the descriptions written for the tests, and from made-up ones of a thousand operations
  to see how long it takes: about two seconds on the machine this was written on. They have not been made from
  the descriptions of public APIs.
- In the tests, descriptions written to break a page (HTML, braces, pipes, code blocks left open) made pages that
  compile, with every table whole and the text shown as text. Each page was also compiled as MDX, and showed the
  same.
- A relative link in a description is read as a link within your site, and
  [`shabd check`](../reference/cli.md) reports it when it leads nowhere.
- A tag whose name has no letter from `a` to `z` and no digit, such as a name in another script, gets the folder
  `group`.
- YAML reads `version: 1.0` as the number 1. Write `version: "1.0"`.
- A `.json` file with a comma after the last item of a list is not JSON, and is read all the same.
